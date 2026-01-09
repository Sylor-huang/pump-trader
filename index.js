import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  Keypair
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint
} from "@solana/spl-token";

import BN from "bn.js";
import bs58 from "bs58";

/* ================= 常量定义 ================= */

const PROGRAM_IDS = {
  PUMP: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
  PUMP_AMM: new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
  METADATA: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
  FEE: new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"),
  EVENT_AUTHORITY: new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1")
};

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const SEEDS = {
  FEE_CONFIG: new Uint8Array([
    1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
    81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176
  ]),
  AMM_FEE_CONFIG: Buffer.from([
    12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101,
    244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99
  ]),
  GLOBAL: Buffer.from("global"),
  BONDING: Buffer.from("bonding-curve")
};

const DISCRIMINATORS = {
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
  TRADE_EVENT: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238])
};

const AMM_FEE_BPS = 100n; // 1%
const BPS_DENOMINATOR = 10000n;

/* ================= 工具函数 ================= */

const u64 = (v) => new BN(v.toString()).toArrayLike(Buffer, "le", 8);

const readU64 = (buf, offset) => {
  const value = buf.readBigUInt64LE(offset);
  return [value, offset + 8];
};

const readU32 = (buf, offsetObj) => {
  const value = buf.readUInt32LE(offsetObj.offset);
  offsetObj.offset += 4;
  return value;
};

const readString = (buf, offsetObj) => {
  const len = readU32(buf, offsetObj);
  const str = buf.slice(offsetObj.offset, offsetObj.offset + len).toString("utf8");
  offsetObj.offset += len;
  return str;
};

/* ================= 解析函数 ================= */

function parseMetadataAccount(data) {
  const offsetObj = { offset: 1 }; // 跳过 key

  const updateAuthority = new PublicKey(data.slice(offsetObj.offset, offsetObj.offset + 32));
  offsetObj.offset += 32;

  const mint = new PublicKey(data.slice(offsetObj.offset, offsetObj.offset + 32));
  offsetObj.offset += 32;

  const name = readString(data, offsetObj);
  const symbol = readString(data, offsetObj);
  const uri = readString(data, offsetObj);

  return {
    updateAuthority: updateAuthority.toBase58(),
    mint: mint.toBase58(),
    name,
    symbol,
    uri
  };
}

function parsePoolKeys(data) {
  if (!data || data.length < 280) {
    throw new Error('Invalid pool account data');
  }

  let offset = 8; // 跳过 discriminator

  const poolBump = data.readUInt8(offset);
  offset += 1;

  const index = data.readUInt16LE(offset);
  offset += 2;

  const creator = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const baseMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const quoteMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const lpMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const poolBaseTokenAccount = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const poolQuoteTokenAccount = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const lpSupply = data.readBigUInt64LE(offset);
  offset += 8;

  const coinCreator = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const isMayhemMode = data.readUInt8(offset) === 1;

  return {
    creator,
    baseMint,
    quoteMint,
    lpMint,
    poolBaseTokenAccount,
    poolQuoteTokenAccount,
    coinCreator,
    isMayhemMode
  };
}

/* ================= PumpTrader 类 ================= */

export class PumpTrader {
  constructor(rpc, privateKey) {
    this.connection = new Connection(rpc, "confirmed");
    this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    this.global = PublicKey.findProgramAddressSync([SEEDS.GLOBAL], PROGRAM_IDS.PUMP)[0];
    this.globalState = null;
    this.tokenProgramCache = new Map(); // 缓存token program检测结果
  }

  /* ---------- Token Program 检测 ---------- */

  /**
   * 自动检测代币使用的 token program (TOKEN_PROGRAM_ID 或 TOKEN_2022_PROGRAM_ID)
   * @param {string} tokenAddr - 代币地址
   * @returns {Promise<{type: string, programId: PublicKey}>}
   */
  async detectTokenProgram(tokenAddr) {
    // 检查缓存
    if (this.tokenProgramCache.has(tokenAddr)) {
      return this.tokenProgramCache.get(tokenAddr);
    }

    const mint = new PublicKey(tokenAddr);

    try {
      // 首先尝试获取 TOKEN_2022 的代币信息
      const mintData = await getMint(this.connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
      const result = {
        type: "TOKEN_2022_PROGRAM_ID",
        programId: TOKEN_2022_PROGRAM_ID
      };
      this.tokenProgramCache.set(tokenAddr, result);
      return result;
    } catch (e) {
      try {
        // 如果失败，尝试标准 TOKEN_PROGRAM_ID
        const mintData = await getMint(this.connection, mint, "confirmed", TOKEN_PROGRAM_ID);
        const result = {
          type: "TOKEN_PROGRAM_ID",
          programId: TOKEN_PROGRAM_ID
        };
        this.tokenProgramCache.set(tokenAddr, result);
        return result;
      } catch (error) {
        throw new Error(`Failed to detect token program for ${tokenAddr}: ${error}`);
      }
    }
  }

  /* ---------- 内盘/外盘检测 ---------- */

  /**
   * 检测代币是否已完成内盘绑定曲线（已进入外盘AMM）
   * @param {string} tokenAddr - 代币地址
   * @returns {Promise<boolean>} true表示在外盘，false表示还在内盘
   */
  async isAmmCompleted(tokenAddr) {
    try {
      const mint = new PublicKey(tokenAddr);
      const { state } = await this.loadBonding(mint);
      return state.complete;
    } catch (error) {
      // 如果无法加载内盘，说明可能已经在外盘或代币不存在
      return true;
    }
  }

  /**
   * 自动判断应该使用内盘还是外盘交易
   * @param {string} tokenAddr - 代币地址
   * @returns {Promise<string>} "bonding" 或 "amm"
   */
  async getTradeMode(tokenAddr) {
    const isAmmMode = await this.isAmmCompleted(tokenAddr);
    return isAmmMode ? "amm" : "bonding";
  }

  /* ---------- Global State ---------- */

  async loadGlobal() {
    const acc = await this.connection.getAccountInfo(this.global);
    if (!acc) throw new Error("Global account not found");

    const data = acc.data;
    let offset = 8;

    const readBool = () => data[offset++] === 1;
    const readPk = () => {
      const pk = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      return pk;
    };
    const readU64 = () => {
      const v = data.readBigUInt64LE(offset);
      offset += 8;
      return v;
    };

    this.globalState = {
      initialized: readBool(),
      authority: readPk(),
      feeRecipient: readPk(),
      withdrawAuthority: readPk(),
      initialVirtualTokenReserves: readU64(),
      initialVirtualSolReserves: readU64(),
      initialRealTokenReserves: readU64(),
      tokenTotalSupply: readU64(),
      feeBasisPoints: readU64()
    };

    return this.globalState;
  }

  /* ---------- Bonding Curve ---------- */

  getBondingPda(mint) {
    return PublicKey.findProgramAddressSync(
      [SEEDS.BONDING, mint.toBuffer()],
      PROGRAM_IDS.PUMP
    )[0];
  }

  async loadBonding(mint) {
    const bonding = this.getBondingPda(mint);
    const acc = await this.connection.getAccountInfo(bonding);
    if (!acc) throw new Error("Bonding curve not found");

    let offset = 8;
    const data = acc.data;

    const state = {};
    [state.virtualTokenReserves, offset] = readU64(data, offset);
    [state.virtualSolReserves, offset] = readU64(data, offset);
    [state.realTokenReserves, offset] = readU64(data, offset);
    [state.realSolReserves, offset] = readU64(data, offset);
    [state.tokenTotalSupply, offset] = readU64(data, offset);
    state.complete = data[offset] === 1;
    offset += 1;

    const creator = new PublicKey(data.slice(offset, offset + 32));

    return { bonding, state, creator };
  }

  /* ---------- 价格计算 ---------- */

  calcBuy(solIn, state) {
    const newVirtualSol = state.virtualSolReserves + solIn;
    const newVirtualToken = (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualSol;
    return state.virtualTokenReserves - newVirtualToken;
  }

  calcSell(tokenIn, state) {
    const newVirtualToken = state.virtualTokenReserves + tokenIn;
    const newVirtualSol = (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualToken;
    return state.virtualSolReserves - newVirtualSol;
  }

  calculateAmmBuyOutput(quoteIn, reserves) {
    const quoteInAfterFee = (quoteIn * (BPS_DENOMINATOR - AMM_FEE_BPS)) / BPS_DENOMINATOR;
    const numerator = reserves.baseAmount * quoteInAfterFee;
    const denominator = reserves.quoteAmount + quoteInAfterFee;
    return numerator / denominator;
  }

  calculateAmmSellOutput(baseIn, reserves) {
    const baseInAfterFee = (baseIn * (BPS_DENOMINATOR - AMM_FEE_BPS)) / BPS_DENOMINATOR;
    const numerator = reserves.quoteAmount * baseInAfterFee;
    const denominator = reserves.baseAmount + baseInAfterFee;
    return numerator / denominator;
  }

  /* ---------- 价格查询 ---------- */

  async getPriceAndStatus(tokenAddr) {
    const mint = new PublicKey(tokenAddr);
    const { state } = await this.loadBonding(mint);

    if (state.complete) {
      const price = await this.getAmmPrice(mint);
      return { price, completed: true };
    }

    const oneToken = BigInt(1_000_000);
    const solOut = this.calcSell(oneToken, state);
    const price = Number(solOut) / 1e9;
    return { price, completed: false };
  }

  async getAmmPrice(mint) {
    const [poolCreator] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mint.toBuffer()],
      PROGRAM_IDS.PUMP
    );

    const indexBuffer = new BN(0).toArrayLike(Buffer, "le", 2);
    const [pool] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), indexBuffer, poolCreator.toBuffer(), mint.toBuffer(), SOL_MINT.toBuffer()],
      PROGRAM_IDS.PUMP_AMM
    );

    const acc = await this.connection.getAccountInfo(pool);
    if (!acc) throw new Error("Pool not found");

    const poolKeys = parsePoolKeys(acc.data);
    const [baseInfo, quoteInfo] = await Promise.all([
      this.connection.getTokenAccountBalance(poolKeys.poolBaseTokenAccount),
      this.connection.getTokenAccountBalance(poolKeys.poolQuoteTokenAccount)
    ]);

    return quoteInfo.value.uiAmount / baseInfo.value.uiAmount;
  }

  /* ---------- 余额查询 ---------- */

  /**
   * 查询代币余额
   * @param {string} tokenAddr - 代币地址（可选），如果不传则返回所有代币
   * @returns {Promise<number|Array>} 如果传入地址则返回该代币的余额数字，否则返回所有代币的详细信息
   */
  async tokenBalance(tokenAddr = null) {
    if (tokenAddr) {
      // 查询单个代币
      const mint = new PublicKey(tokenAddr);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { mint }
      );
      return tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;
    } else {
      // 查询所有代币
      return this.getAllTokenBalances();
    }
  }

  /**
   * 获取账户所有代币余额（仅显示余额 > 0 的）
   * @returns {Promise<Array>} 代币信息数组，包含mint地址、余额等信息
   */
  async getAllTokenBalances() {
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    const balances = tokenAccounts.value
      .map((account) => {
        const parsed = account.account.data.parsed;
        if (parsed.type !== 'account') return null;

        const tokenAmount = parsed.info.tokenAmount;
        if (Number(tokenAmount.amount) === 0) return null;

        return {
          mint: parsed.info.mint,
          amount: BigInt(tokenAmount.amount),
          decimals: tokenAmount.decimals,
          uiAmount: tokenAmount.uiAmount || 0
        };
      })
      .filter((item) => item !== null);

    // 同时查询 TOKEN_2022_PROGRAM_ID
    const token2022Accounts = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { programId: TOKEN_2022_PROGRAM_ID }
    );

    const token2022Balances = token2022Accounts.value
      .map((account) => {
        const parsed = account.account.data.parsed;
        if (parsed.type !== 'account') return null;

        const tokenAmount = parsed.info.tokenAmount;
        if (Number(tokenAmount.amount) === 0) return null;

        return {
          mint: parsed.info.mint,
          amount: BigInt(tokenAmount.amount),
          decimals: tokenAmount.decimals,
          uiAmount: tokenAmount.uiAmount || 0
        };
      })
      .filter((item) => item !== null);

    // 合并并去重
    const allBalances = [...balances, ...token2022Balances];
    const seen = new Set();
    const uniqueBalances = allBalances
      .filter((b) => {
        if (seen.has(b.mint)) return false;
        seen.add(b.mint);
        return true;
      })
      .map((b) => ({
        mint: b.mint,
        amount: Number(b.amount),
        decimals: b.decimals,
        uiAmount: b.uiAmount
      }));

    return uniqueBalances;
  }

  async solBalance() {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / 1e9;
  }

  /* ---------- ATA 管理 ---------- */

  async ensureAta(tx, mint, tokenProgram = null) {
    const program = tokenProgram || TOKEN_2022_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(
      mint,
      this.wallet.publicKey,
      false,
      program,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const acc = await this.connection.getAccountInfo(ata);
    if (!acc) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          ata,
          this.wallet.publicKey,
          mint,
          program,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    return ata;
  }

  async ensureWSOLAta(tx, owner, mode, lamports = 0n) {
    const wsolAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const acc = await this.connection.getAccountInfo(wsolAta);

    if (!acc) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          wsolAta,
          owner,
          SOL_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    if (mode === 'buy') {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: wsolAta,
          lamports: Number(lamports)
        })
      );
      tx.add(createSyncNativeInstruction(wsolAta));
    }

    return wsolAta;
  }

  /* ---------- 交易参数处理 ---------- */

  genPriority(priorityOpt) {
    if (!priorityOpt?.enableRandom || !priorityOpt.randomRange) {
      return priorityOpt.base;
    }
    return priorityOpt.base + Math.floor(Math.random() * priorityOpt.randomRange);
  }

  calcSlippage({ tradeSize, reserve, slippageOpt }) {
    const impact = Number(tradeSize) / Math.max(Number(reserve), 1);
    const factor = slippageOpt.impactFactor ?? 1;

    let slip = slippageOpt.base + Math.floor(impact * 10_000 * factor);

    if (slippageOpt.max !== undefined) {
      slip = Math.min(slip, slippageOpt.max);
    }
    if (slippageOpt.min !== undefined) {
      slip = Math.max(slip, slippageOpt.min);
    }

    return slip;
  }

  splitByMax(total, max) {
    const chunks = [];
    let remaining = total;

    while (remaining > 0n) {
      const chunk = remaining > max ? max : remaining;
      chunks.push(chunk);
      remaining -= chunk;
    }
    return chunks;
  }

  splitIntoN(total, n) {
    const chunks = [];
    const part = total / BigInt(n);
    let remaining = total;

    for (let i = 0; i < n; i++) {
      const chunk = i === n - 1 ? remaining : part;
      chunks.push(chunk);
      remaining -= chunk;
    }
    return chunks;
  }

  /* ---------- 内盘交易 ---------- */

  /**
   * 统一的自动买入接口，自动判断内盘/外盘
   */
  async autoBuy(tokenAddr, totalSolIn, tradeOpt) {
    const mode = await this.getTradeMode(tokenAddr);
    if (mode === "bonding") {
      return this.buy(tokenAddr, totalSolIn, tradeOpt);
    } else {
      return this.ammBuy(tokenAddr, totalSolIn, tradeOpt);
    }
  }

  /**
   * 统一的自动卖出接口，自动判断内盘/外盘
   */
  async autoSell(tokenAddr, totalTokenIn, tradeOpt) {
    const mode = await this.getTradeMode(tokenAddr);
    if (mode === "bonding") {
      return this.sell(tokenAddr, totalTokenIn, tradeOpt);
    } else {
      return this.ammSell(tokenAddr, totalTokenIn, tradeOpt);
    }
  }

  async buy(tokenAddr, totalSolIn, tradeOpt) {
    const mint = new PublicKey(tokenAddr);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);

    if (!this.globalState) await this.loadGlobal();

    const { bonding, state, creator } = await this.loadBonding(mint);
    if (state.complete) throw new Error("Bonding curve already completed");
    const solChunks = this.splitByMax(totalSolIn, tradeOpt.maxSolPerTx);
    const pendingTransactions = []; // 待确认的交易
    const failedTransactions = []; // 发送失败的交易
    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint,
      bonding,
      true,
      tokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PROGRAM_IDS.PUMP
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_volume_accumulator"), this.wallet.publicKey.toBuffer()],
      PROGRAM_IDS.PUMP
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.FEE_CONFIG],
      PROGRAM_IDS.FEE
    );

    for (let i = 0; i < solChunks.length; i++) {
      try {
        const solIn = solChunks[i];
        const tokenOut = this.calcBuy(solIn, state);
        const slippageBps = this.calcSlippage({
          tradeSize: solIn,
          reserve: state.virtualSolReserves,
          slippageOpt: tradeOpt.slippage
        });
        const maxSol = (solIn * BigInt(10_000 + slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority })
        );

        const userAta = await this.ensureAta(tx, mint, tokenProgram.programId);

        tx.add(
          new TransactionInstruction({
            programId: PROGRAM_IDS.PUMP,
            keys: [
              { pubkey: this.global, isSigner: false, isWritable: false },
              { pubkey: this.globalState.feeRecipient, isSigner: false, isWritable: true },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: bonding, isSigner: false, isWritable: true },
              { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
              { pubkey: userAta, isSigner: false, isWritable: true },
              { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: tokenProgram.programId, isSigner: false, isWritable: false },
              { pubkey: creatorVault, isSigner: false, isWritable: true },
              { pubkey: PROGRAM_IDS.EVENT_AUTHORITY, isSigner: false, isWritable: false },
              { pubkey: PROGRAM_IDS.PUMP, isSigner: false, isWritable: false },
              { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
              { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
              { pubkey: feeConfig, isSigner: false, isWritable: false },
              { pubkey: PROGRAM_IDS.FEE, isSigner: false, isWritable: false }
            ],
            data: Buffer.concat([DISCRIMINATORS.BUY, u64(tokenOut), u64(maxSol)])
          })
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 2
        });

        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: e.message
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  async sell(tokenAddr, totalTokenIn, tradeOpt) {
    const mint = new PublicKey(tokenAddr);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);

    if (!this.globalState) await this.loadGlobal();

    const { bonding, state, creator } = await this.loadBonding(mint);
    if (state.complete) throw new Error("Bonding curve already completed");

    const totalSolOut = this.calcSell(totalTokenIn, state);
    const tokenChunks = totalSolOut <= tradeOpt.maxSolPerTx
      ? [totalTokenIn]
      : this.splitIntoN(
        totalTokenIn,
        Number((totalSolOut + tradeOpt.maxSolPerTx - 1n) / tradeOpt.maxSolPerTx)
      );

    const pendingTransactions = []; // 待确认的交易
    const failedTransactions = []; // 发送失败的交易

    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint,
      bonding,
      true,
      tokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const userAta = getAssociatedTokenAddressSync(
      mint,
      this.wallet.publicKey,
      false,
      tokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.FEE_CONFIG],
      PROGRAM_IDS.FEE
    );

    for (let i = 0; i < tokenChunks.length; i++) {
      try {
        const tokenIn = tokenChunks[i];
        const solOut = this.calcSell(tokenIn, state);
        const slippageBps = this.calcSlippage({
          tradeSize: tokenIn,
          reserve: state.virtualTokenReserves,
          slippageOpt: tradeOpt.slippage
        });
        const minSol = (solOut * BigInt(10_000 - slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority })
        );

        tx.add(
          new TransactionInstruction({
            programId: PROGRAM_IDS.PUMP,
            keys: [
              { pubkey: this.global, isSigner: false, isWritable: false },
              { pubkey: this.globalState.feeRecipient, isSigner: false, isWritable: true },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: bonding, isSigner: false, isWritable: true },
              { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
              { pubkey: userAta, isSigner: false, isWritable: true },
              { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: creatorVault, isSigner: false, isWritable: true },
              { pubkey: tokenProgram.programId, isSigner: false, isWritable: false },
              { pubkey: PROGRAM_IDS.EVENT_AUTHORITY, isSigner: false, isWritable: false },
              { pubkey: PROGRAM_IDS.PUMP, isSigner: false, isWritable: false },
              { pubkey: feeConfig, isSigner: false, isWritable: false },
              { pubkey: PROGRAM_IDS.FEE, isSigner: false, isWritable: false }
            ],
            data: Buffer.concat([
              DISCRIMINATORS.SELL,
              u64(tokenIn),
              u64(minSol > 0n ? minSol : 1n)
            ])
          })
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(tx.serialize());
        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: e.message
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  /* ---------- 外盘交易 ---------- */

  async ammBuy(tokenAddr, totalSolIn, tradeOpt) {
    const mint = new PublicKey(tokenAddr);
    const poolInfo = await this.getAmmPoolInfo(mint);
    const reserves = await this.getAmmPoolReserves(poolInfo.poolKeys);
    const solChunks = this.splitByMax(totalSolIn, tradeOpt.maxSolPerTx);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);
    const pendingTransactions = [];
    const failedTransactions = [];

    for (let i = 0; i < solChunks.length; i++) {
      try {
        const solIn = solChunks[i];
        const baseAmountOut = this.calculateAmmBuyOutput(solIn, reserves);
        const slippageBps = this.calcSlippage({
          tradeSize: solIn,
          reserve: reserves.quoteAmount,
          slippageOpt: tradeOpt.slippage
        });
        const maxQuoteIn = (solIn * BigInt(10_000 + slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority })
        );

        const userBaseAta = await this.ensureAta(tx, poolInfo.poolKeys.baseMint, tokenProgram.programId);
        const userQuoteAta = await this.ensureWSOLAta(
          tx,
          this.wallet.publicKey,
          "buy",
          maxQuoteIn
        );

        const buyIx = this.createAmmBuyInstruction(
          poolInfo,
          userBaseAta,
          userQuoteAta,
          baseAmountOut,
          maxQuoteIn,
          tokenProgram.programId
        );

        tx.add(buyIx);
        tx.add(
          createCloseAccountInstruction(
            userQuoteAta,
            this.wallet.publicKey,
            this.wallet.publicKey
          )
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 2
        });

        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: e.message
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  async ammSell(tokenAddr, totalTokenIn, tradeOpt) {
    const mint = new PublicKey(tokenAddr);
    const poolInfo = await this.getAmmPoolInfo(mint);
    const reserves = await this.getAmmPoolReserves(poolInfo.poolKeys);
    const totalSolOut = this.calculateAmmSellOutput(totalTokenIn, reserves);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);

    const tokenChunks = totalSolOut <= tradeOpt.maxSolPerTx
      ? [totalTokenIn]
      : this.splitIntoN(
        totalTokenIn,
        Number((totalSolOut + tradeOpt.maxSolPerTx - 1n) / tradeOpt.maxSolPerTx)
      );

    const pendingTransactions = [];
    const failedTransactions = [];

    for (let i = 0; i < tokenChunks.length; i++) {
      try {
        const tokenIn = tokenChunks[i];
        const solOut = this.calculateAmmSellOutput(tokenIn, reserves);
        const slippageBps = this.calcSlippage({
          tradeSize: tokenIn,
          reserve: reserves.baseAmount,
          slippageOpt: tradeOpt.slippage
        });
        const minQuoteOut = (solOut * BigInt(10_000 - slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority })
        );

        const userBaseAta = await this.ensureAta(tx, poolInfo.poolKeys.baseMint, tokenProgram.programId);
        const userQuoteAta = await this.ensureWSOLAta(tx, this.wallet.publicKey, "sell");

        const sellIx = this.createAmmSellInstruction(
          poolInfo,
          userBaseAta,
          userQuoteAta,
          tokenIn,
          minQuoteOut,
          tokenProgram.programId
        );

        tx.add(sellIx);
        tx.add(
          createCloseAccountInstruction(
            userQuoteAta,
            this.wallet.publicKey,
            this.wallet.publicKey
          )
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 2
        });

        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: e.message
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  /* ---------- AMM 池信息 ---------- */

  async getAmmPoolInfo(mint) {
    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mint.toBuffer()],
      PROGRAM_IDS.PUMP
    );

    const [pool] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new BN(0).toArrayLike(Buffer, "le", 2),
        poolAuthority.toBuffer(),
        mint.toBuffer(),
        SOL_MINT.toBuffer()
      ],
      PROGRAM_IDS.PUMP_AMM
    );

    const acc = await this.connection.getAccountInfo(pool);
    if (!acc) throw new Error("AMM pool not found");

    const poolKeys = parsePoolKeys(acc.data);

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")],
      PROGRAM_IDS.PUMP_AMM
    );

    const globalConfigAcc = await this.connection.getAccountInfo(globalConfigPda);
    if (!globalConfigAcc) throw new Error("Global config not found");

    const globalConfig = this.parseAmmGlobalConfig(globalConfigAcc.data, globalConfigPda);

    return { pool, poolAuthority, poolKeys, globalConfig };
  }

  parseAmmGlobalConfig(data, address) {
    let offset = 8; // discriminator

    const admin = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    offset += 8; // lpFeeBasisPoints
    offset += 8; // protocolFeeBasisPoints
    offset += 1; // disableFlags

    const protocolFeeRecipients = [];
    for (let i = 0; i < 8; i++) {
      protocolFeeRecipients.push(new PublicKey(data.slice(offset, offset + 32)));
      offset += 32;
    }

    return { address, admin, protocolFeeRecipients };
  }

  async getAmmPoolReserves(poolKeys) {
    const [baseInfo, quoteInfo] = await Promise.all([
      this.connection.getTokenAccountBalance(poolKeys.poolBaseTokenAccount),
      this.connection.getTokenAccountBalance(poolKeys.poolQuoteTokenAccount)
    ]);

    return {
      baseAmount: BigInt(baseInfo.value.amount),
      quoteAmount: BigInt(quoteInfo.value.amount),
      baseDecimals: baseInfo.value.decimals,
      quoteDecimals: quoteInfo.value.decimals
    };
  }

  /* ---------- AMM 指令构建 ---------- */

  createAmmBuyInstruction(poolInfo, userBaseAta, userQuoteAta, baseAmountOut, maxQuoteAmountIn, tokenProgramId) {
    const { pool, poolKeys, globalConfig } = poolInfo;

    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PROGRAM_IDS.PUMP_AMM
    );

    const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), poolKeys.coinCreator.toBuffer()],
      PROGRAM_IDS.PUMP_AMM
    );

    const coinCreatorVaultAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      coinCreatorVaultAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PROGRAM_IDS.PUMP_AMM
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_volume_accumulator"), this.wallet.publicKey.toBuffer()],
      PROGRAM_IDS.PUMP_AMM
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.AMM_FEE_CONFIG],
      PROGRAM_IDS.FEE
    );

    const protocolFeeRecipient = globalConfig.protocolFeeRecipients[0];
    const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      SOL_MINT,
      protocolFeeRecipient,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return new TransactionInstruction({
      programId: PROGRAM_IDS.PUMP_AMM,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: globalConfig.address, isSigner: false, isWritable: false },
        { pubkey: poolKeys.baseMint, isSigner: false, isWritable: false },
        { pubkey: poolKeys.quoteMint, isSigner: false, isWritable: false },
        { pubkey: userBaseAta, isSigner: false, isWritable: true },
        { pubkey: userQuoteAta, isSigner: false, isWritable: true },
        { pubkey: poolKeys.poolBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolKeys.poolQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },
        { pubkey: protocolFeeRecipientTokenAccount, isSigner: false, isWritable: true },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.PUMP_AMM, isSigner: false, isWritable: false },
        { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
        { pubkey: coinCreatorVaultAuthority, isSigner: false, isWritable: false },
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.FEE, isSigner: false, isWritable: false }
      ],
      data: Buffer.concat([
        DISCRIMINATORS.BUY,
        u64(baseAmountOut),
        u64(maxQuoteAmountIn),
        Buffer.from([1, 1]) // trackVolume = Some(true)
      ])
    });
  }

  createAmmSellInstruction(poolInfo, userBaseAta, userQuoteAta, baseAmountIn, minQuoteAmountOut, tokenProgramId) {
    const { pool, poolKeys, globalConfig } = poolInfo;

    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PROGRAM_IDS.PUMP_AMM
    );

    const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), poolKeys.coinCreator.toBuffer()],
      PROGRAM_IDS.PUMP_AMM
    );

    const coinCreatorVaultAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      coinCreatorVaultAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.AMM_FEE_CONFIG],
      PROGRAM_IDS.FEE
    );

    const protocolFeeRecipient = globalConfig.protocolFeeRecipients[0];
    const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      SOL_MINT,
      protocolFeeRecipient,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return new TransactionInstruction({
      programId: PROGRAM_IDS.PUMP_AMM,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: globalConfig.address, isSigner: false, isWritable: false },
        { pubkey: poolKeys.baseMint, isSigner: false, isWritable: false },
        { pubkey: poolKeys.quoteMint, isSigner: false, isWritable: false },
        { pubkey: userBaseAta, isSigner: false, isWritable: true },
        { pubkey: userQuoteAta, isSigner: false, isWritable: true },
        { pubkey: poolKeys.poolBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolKeys.poolQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },
        { pubkey: protocolFeeRecipientTokenAccount, isSigner: false, isWritable: true },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.PUMP_AMM, isSigner: false, isWritable: false },
        { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
        { pubkey: coinCreatorVaultAuthority, isSigner: false, isWritable: false },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.FEE, isSigner: false, isWritable: false }
      ],
      data: Buffer.concat([
        DISCRIMINATORS.SELL,
        u64(baseAmountIn),
        u64(minQuoteAmountOut > 0n ? minQuoteAmountOut : 1n)
      ])
    });
  }

  /* ---------- 交易确认 ---------- */

  async confirmTransactionWithPolling(signature, lastValidBlockHeight, maxAttempts = 5, delayMs = 2000) {
    console.log('✅ 交易已发送:', signature);
    console.log('🔗 查看交易: https://solscan.io/tx/' + signature);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));

      try {
        console.log(`🔍 检查交易状态 (${attempt}/${maxAttempts})...`);

        const txInfo = await this.connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (txInfo) {
          if (txInfo.meta?.err) {
            console.error('❌ 交易失败:', txInfo.meta.err);
            throw new Error('交易失败: ' + JSON.stringify(txInfo.meta.err));
          }

          console.log('✅ 交易已确认!');
          return signature;
        }

        const currentBlockHeight = await this.connection.getBlockHeight('finalized');
        if (currentBlockHeight > lastValidBlockHeight) {
          console.log('⚠️ 交易已过期（超过有效区块高度）');
          throw new Error('交易过期：未在有效区块高度内确认');
        }

      } catch (error) {
        if (error.message?.includes('交易失败') || error.message?.includes('交易过期')) {
          throw error;
        }
        console.log(`⚠️ 查询出错，继续重试: ${error.message}`);
      }
    }

    throw new Error(
      `交易确认超时（已尝试 ${maxAttempts} 次），签名: ${signature}。请手动检查交易状态。`
    );
  }

  /* ---------- 事件监听 ---------- */

  listenTrades(callback, mintFilter = null) {
    return this.connection.onLogs(
      PROGRAM_IDS.PUMP,
      (log) => {
        for (const logLine of log.logs) {
          if (!logLine.startsWith("Program data: ")) continue;

          const buf = Buffer.from(logLine.replace("Program data: ", ""), "base64");

          if (!buf.subarray(0, 8).equals(DISCRIMINATORS.TRADE_EVENT)) continue;

          let offset = 8;
          const mint = new PublicKey(buf.slice(offset, offset + 32));
          offset += 32;

          if (mintFilter && !mint.equals(mintFilter)) return;

          const solAmount = buf.readBigUInt64LE(offset);
          offset += 8;
          const tokenAmount = buf.readBigUInt64LE(offset);
          offset += 8;
          const isBuy = buf[offset++] === 1;
          const user = new PublicKey(buf.slice(offset, offset + 32));
          offset += 32;
          const timestamp = Number(buf.readBigInt64LE(offset));

          callback({
            mint: mint.toBase58(),
            solAmount,
            tokenAmount,
            isBuy,
            user: user.toBase58(),
            timestamp,
            signature: log.signature
          });
        }
      },
      "confirmed"
    );
  }

  /* ---------- 元数据查询 ---------- */

  async fetchMeta(tokenAddr) {
    const mint = new PublicKey(tokenAddr);

    try {
      const metadata = await getTokenMetadata(
        this.connection,
        mint,
        TOKEN_2022_PROGRAM_ID
      );

      return {
        name: metadata?.name || "",
        symbol: metadata?.symbol || "",
        uri: metadata?.uri || ""
      };
    } catch (e) {
      const metadataPda = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), PROGRAM_IDS.METADATA.toBuffer(), mint.toBuffer()],
        PROGRAM_IDS.METADATA
      )[0];

      const acc = await this.connection.getAccountInfo(metadataPda);
      if (!acc) return null;

      const meta = parseMetadataAccount(acc.data);

      return {
        name: meta?.name?.replace(/\u0000/g, '') || "",
        symbol: meta?.symbol?.replace(/\u0000/g, '') || "",
        uri: meta?.uri?.replace(/\u0000/g, '') || ""
      };
    }
  }

  /* ---------- 辅助方法 ---------- */

  /**
   * 获取钱包信息
   */
  getWallet() {
    return this.wallet;
  }

  /**
   * 获取连接信息
   */
  getConnection() {
    return this.connection;
  }

  /**
   * 清除token program缓存
   */
  clearTokenProgramCache(tokenAddr = null) {
    if (tokenAddr) {
      this.tokenProgramCache.delete(tokenAddr);
    } else {
      this.tokenProgramCache.clear();
    }
  }

  /**
   * 获取缓存的token program信息
   */
  getCachedTokenProgram(tokenAddr) {
    return this.tokenProgramCache.get(tokenAddr);
  }
}
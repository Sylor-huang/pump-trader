import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  SystemProgram,
  ComputeBudgetProgram,
  Keypair,
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
  getMint,
} from "@solana/spl-token";

import BN from "bn.js";
import bs58 from "bs58";

/* ================= 类型定义 ================= */

interface TradeOptions {
  maxSolPerTx: bigint;
  slippage: {
    base: number;
    max?: number;
    min?: number;
    impactFactor?: number;
  };
  priority: {
    base: number;
    enableRandom?: boolean;
    randomRange?: number;
  };
}

interface PendingTransaction {
  signature: string;
  lastValidBlockHeight: number;
  index: number;
}

interface FailedTransaction {
  index: number;
  error: string;
}

interface TradeResult {
  pendingTransactions: PendingTransaction[];
  failedTransactions: FailedTransaction[];
}

interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  isMayhemMode?: boolean;
  isCashbackCoin?: boolean;
  // V2 fields
  quoteMint?: PublicKey;
  virtualQuoteReserves?: bigint;
  realQuoteReserves?: bigint;
}

interface BondingInfo {
  bonding: PublicKey;
  state: BondingCurveState;
  creator: PublicKey;
}

interface PoolReserves {
  baseAmount: bigint;
  quoteAmount: bigint;
  baseDecimals: number;
  quoteDecimals: number;
}

interface TradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
  signature: string;
}

interface GlobalState {
  initialized: boolean;
  authority: PublicKey;
  feeRecipient: PublicKey;
  withdrawAuthority: PublicKey;
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  feeBasisPoints: bigint;
}

interface TokenProgramType {
  type: "TOKEN_PROGRAM_ID" | "TOKEN_2022_PROGRAM_ID";
  programId: PublicKey;
}

interface PoolInfo {
  pool: PublicKey;
  poolAuthority: PublicKey;
  poolKeys: any;
  globalConfig: any;
}

interface MetadataInfo {
  name: string;
  symbol: string;
  uri: string;
}

/* ================= 常量定义 ================= */

const PROGRAM_IDS = {
  PUMP: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
  PUMP_AMM: new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
  METADATA: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
  FEE: new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"),
  EVENT_AUTHORITY: new PublicKey(
    "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
  ),
};

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const SEEDS = {
  FEE_CONFIG: new Uint8Array([
    1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81,
    137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
  ]),
  AMM_FEE_CONFIG: Buffer.from([
    12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101, 244,
    41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99,
  ]),
  GLOBAL: Buffer.from("global"),
  BONDING: Buffer.from("bonding-curve"),
};

const DISCRIMINATORS = {
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
  TRADE_EVENT: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  // V2 instructions
  BUY_V2: Buffer.from([184, 23, 238, 97, 103, 197, 211, 61]),
  SELL_V2: Buffer.from([93, 246, 130, 60, 231, 233, 64, 178]),
  BUY_EXACT_QUOTE_IN_V2: Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]),
  COLLECT_CREATOR_FEE_V2: Buffer.from([207, 17, 138, 242, 4, 34, 19, 56]),
};

const AMM_FEE_BPS = 100n;
const BPS_DENOMINATOR = 10000n;
const PUMP_NEW_FEE_RECIPIENTS = [
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
].map((value) => new PublicKey(value));

const PUMP_RESERVED_FEE_RECIPIENTS = [
  "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
  "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
  "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
  "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
  "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
  "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
  "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
  "6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA",
].map((value) => new PublicKey(value));

const PUMP_BUYBACK_FEE_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
].map((value) => new PublicKey(value));

/* ================= 工具函数 ================= */

const u64 = (v: bigint | BN | number): Buffer => {
  const bn =
    typeof v === "bigint" ? new BN(v.toString()) : new BN(v.toString());
  return bn.toArrayLike(Buffer, "le", 8);
};

const readU64 = (buf: Buffer, offset: number): [bigint, number] => {
  const value = buf.readBigUInt64LE(offset);
  return [value, offset + 8];
};

const readU32 = (buf: Buffer, offsetObj: { offset: number }): number => {
  const value = buf.readUInt32LE(offsetObj.offset);
  offsetObj.offset += 4;
  return value;
};

const readString = (buf: Buffer, offsetObj: { offset: number }): string => {
  const len = readU32(buf, offsetObj);
  const str = buf
    .slice(offsetObj.offset, offsetObj.offset + len)
    .toString("utf8");
  offsetObj.offset += len;
  return str;
};

/* ================= 解析函数 ================= */

function parseMetadataAccount(data: Buffer) {
  const offsetObj = { offset: 1 };

  const updateAuthority = new PublicKey(
    data.slice(offsetObj.offset, offsetObj.offset + 32),
  );
  offsetObj.offset += 32;

  const mint = new PublicKey(
    data.slice(offsetObj.offset, offsetObj.offset + 32),
  );
  offsetObj.offset += 32;

  const name = readString(data, offsetObj);
  const symbol = readString(data, offsetObj);
  const uri = readString(data, offsetObj);

  return {
    updateAuthority: updateAuthority.toBase58(),
    mint: mint.toBase58(),
    name,
    symbol,
    uri,
  };
}

function parsePoolKeys(data: Buffer) {
  if (!data || data.length < 280) {
    throw new Error("Invalid pool account data");
  }

  let offset = 8;

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
  offset += 1;
  const isCashbackCoin =
    offset < data.length ? data.readUInt8(offset) === 1 : false;

  return {
    creator,
    baseMint,
    quoteMint,
    lpMint,
    poolBaseTokenAccount,
    poolQuoteTokenAccount,
    coinCreator,
    isMayhemMode,
    isCashbackCoin,
  };
}

/* ================= PumpTrader 类 ================= */

export class PumpTrader {
  private connection: Connection;
  private wallet: Keypair;
  private global: PublicKey;
  private globalState: GlobalState | null;
  private tokenProgramCache: Map<string, TokenProgramType>;

  constructor(rpc: string, privateKey: string) {
    this.connection = new Connection(rpc, "confirmed");
    this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    this.global = PublicKey.findProgramAddressSync(
      [SEEDS.GLOBAL],
      PROGRAM_IDS.PUMP,
    )[0];
    this.globalState = null;
    this.tokenProgramCache = new Map();
  }

  /* ---------- Token Program 检测 ---------- */

  /**
   * 自动检测代币使用的 token program
   */
  async detectTokenProgram(tokenAddr: string): Promise<TokenProgramType> {
    // 检查缓存
    if (this.tokenProgramCache.has(tokenAddr)) {
      return this.tokenProgramCache.get(tokenAddr)!;
    }

    const mint = new PublicKey(tokenAddr);

    try {
      // 首先尝试获取 TOKEN_2022 的代币信息
      const mintData = await getMint(
        this.connection,
        mint,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );
      const result: TokenProgramType = {
        type: "TOKEN_2022_PROGRAM_ID",
        programId: TOKEN_2022_PROGRAM_ID,
      };
      this.tokenProgramCache.set(tokenAddr, result);
      return result;
    } catch (e) {
      try {
        // 如果失败，尝试标准 TOKEN_PROGRAM_ID
        const mintData = await getMint(
          this.connection,
          mint,
          "confirmed",
          TOKEN_PROGRAM_ID,
        );
        const result: TokenProgramType = {
          type: "TOKEN_PROGRAM_ID",
          programId: TOKEN_PROGRAM_ID,
        };
        this.tokenProgramCache.set(tokenAddr, result);
        return result;
      } catch (error) {
        throw new Error(
          `Failed to detect token program for ${tokenAddr}: ${error}`,
        );
      }
    }
  }

  async detectQuoteTokenProgram(quoteMint: PublicKey): Promise<PublicKey> {
    const quoteAddr = quoteMint.toBase58();
    if (this.tokenProgramCache.has(quoteAddr)) {
      return this.tokenProgramCache.get(quoteAddr)!.programId;
    }
    try {
      await getMint(
        this.connection,
        quoteMint,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );
      return TOKEN_2022_PROGRAM_ID;
    } catch {
      return TOKEN_PROGRAM_ID;
    }
  }

  /* ---------- 内盘/外盘检测 ---------- */

  /**
   * 检测代币是否在外盘 (AMM)
   */
  async isAmmCompleted(tokenAddr: string): Promise<boolean> {
    try {
      const mint = new PublicKey(tokenAddr);
      const { state } = await this.loadBonding(mint);
      return state.complete;
    } catch (error) {
      // 如果无法加载内盘，说明可能已经在外盘
      return true;
    }
  }

  /**
   * 自动判断应该使用内盘还是外盘
   */
  async getTradeMode(tokenAddr: string): Promise<"bonding" | "amm"> {
    const isAmmMode = await this.isAmmCompleted(tokenAddr);
    if (isAmmMode) return "amm";
    try {
      await this.getAmmPoolInfo(new PublicKey(tokenAddr));
      return "amm";
    } catch {
      return "bonding";
    }
  }

  /* ---------- Global State ---------- */

  async loadGlobal(): Promise<GlobalState> {
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
      feeBasisPoints: readU64(),
    };

    return this.globalState;
  }

  /* ---------- Bonding Curve ---------- */

  getBondingPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.BONDING, mint.toBuffer()],
      PROGRAM_IDS.PUMP,
    )[0];
  }

  deriveBondingCurveV2(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve-v2"), mint.toBuffer()],
      PROGRAM_IDS.PUMP,
    )[0];
  }

  private pickFeeRecipient(index = 0): PublicKey {
    return PUMP_NEW_FEE_RECIPIENTS[index % PUMP_NEW_FEE_RECIPIENTS.length];
  }

  private pickBuybackFeeRecipient(index = 0): PublicKey {
    return PUMP_BUYBACK_FEE_RECIPIENTS[
      index % PUMP_BUYBACK_FEE_RECIPIENTS.length
    ];
  }

  private pickReservedFeeRecipient(index = 0): PublicKey {
    return PUMP_RESERVED_FEE_RECIPIENTS[
      index % PUMP_RESERVED_FEE_RECIPIENTS.length
    ];
  }

  getSharingConfigPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sharing-config"), mint.toBuffer()],
      PROGRAM_IDS.FEE,
    )[0];
  }

  private buildBondingBuyKeys(args: {
    global: PublicKey;
    globalFeeRecipient: PublicKey;
    mint: PublicKey;
    bonding: PublicKey;
    associatedBondingCurve: PublicKey;
    userAta: PublicKey;
    wallet: PublicKey;
    creatorVault: PublicKey;
    eventAuthority: PublicKey;
    pumpProgram: PublicKey;
    globalVolumeAccumulator: PublicKey;
    userVolumeAccumulator: PublicKey;
    feeConfig: PublicKey;
    feeProgram: PublicKey;
    bondingCurveV2: PublicKey;
    feeRecipient: PublicKey;
    tokenProgramId?: PublicKey;
  }): AccountMeta[] {
    const tokenProgramId = args.tokenProgramId ?? TOKEN_PROGRAM_ID;

    return [
      { pubkey: args.global, isSigner: false, isWritable: false },
      { pubkey: args.globalFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.bonding, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.userAta, isSigner: false, isWritable: true },
      { pubkey: args.wallet, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: args.creatorVault, isSigner: false, isWritable: true },
      { pubkey: args.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: args.pumpProgram, isSigner: false, isWritable: false },
      {
        pubkey: args.globalVolumeAccumulator,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: args.userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: args.feeConfig, isSigner: false, isWritable: false },
      { pubkey: args.feeProgram, isSigner: false, isWritable: false },
      { pubkey: args.bondingCurveV2, isSigner: false, isWritable: false },
      { pubkey: args.feeRecipient, isSigner: false, isWritable: true },
    ];
  }

  private buildBondingSellKeys(args: {
    global: PublicKey;
    globalFeeRecipient: PublicKey;
    mint: PublicKey;
    bonding: PublicKey;
    associatedBondingCurve: PublicKey;
    userAta: PublicKey;
    wallet: PublicKey;
    creatorVault: PublicKey;
    eventAuthority: PublicKey;
    pumpProgram: PublicKey;
    feeConfig: PublicKey;
    feeProgram: PublicKey;
    bondingCurveV2: PublicKey;
    feeRecipient: PublicKey;
    isCashbackCoin: boolean;
    userVolumeAccumulator: PublicKey;
    tokenProgramId?: PublicKey;
  }): AccountMeta[] {
    const tokenProgramId = args.tokenProgramId ?? TOKEN_PROGRAM_ID;
    const keys: AccountMeta[] = [
      { pubkey: args.global, isSigner: false, isWritable: false },
      { pubkey: args.globalFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.bonding, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.userAta, isSigner: false, isWritable: true },
      { pubkey: args.wallet, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: args.creatorVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: args.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: args.pumpProgram, isSigner: false, isWritable: false },
      { pubkey: args.feeConfig, isSigner: false, isWritable: false },
      { pubkey: args.feeProgram, isSigner: false, isWritable: false },
    ];

    if (args.isCashbackCoin) {
      keys.push({
        pubkey: args.userVolumeAccumulator,
        isSigner: false,
        isWritable: true,
      });
    }

    keys.push(
      { pubkey: args.bondingCurveV2, isSigner: false, isWritable: false },
      { pubkey: args.feeRecipient, isSigner: false, isWritable: true },
    );

    return keys;
  }

  async loadBonding(mint: PublicKey): Promise<BondingInfo> {
    const bonding = this.getBondingPda(mint);
    const acc = await this.connection.getAccountInfo(bonding);
    if (!acc) throw new Error("Bonding curve not found");

    let offset = 8;
    const data = acc.data;

    const state: BondingCurveState = {} as any;
    [state.virtualTokenReserves, offset] = readU64(data, offset);
    [state.virtualSolReserves, offset] = readU64(data, offset);
    [state.realTokenReserves, offset] = readU64(data, offset);
    [state.realSolReserves, offset] = readU64(data, offset);
    [state.tokenTotalSupply, offset] = readU64(data, offset);
    state.complete = data[offset] === 1;
    offset += 1;

    const creator = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // V2 fields (115-byte bonding curve layout): quote_mint, virtual_quote_reserves, real_quote_reserves
    // For legacy coins these may not be present, check remaining data length
    if (offset + 32 <= data.length) {
      state.quoteMint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
    }
    if (offset + 8 <= data.length) {
      [state.virtualQuoteReserves, offset] = readU64(data, offset);
    }
    if (offset + 8 <= data.length) {
      [state.realQuoteReserves, offset] = readU64(data, offset);
    }

    state.isMayhemMode = offset < data.length ? data[offset] === 1 : false;
    offset += 1;
    state.isCashbackCoin = offset < data.length ? data[offset] === 1 : false;

    return { bonding, state, creator };
  }

  /* ---------- 价格计算 ---------- */

  calcBuy(solIn: bigint, state: BondingCurveState): bigint {
    const newVirtualSol = state.virtualSolReserves + solIn;
    const newVirtualToken =
      (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualSol;
    return state.virtualTokenReserves - newVirtualToken;
  }

  calcSell(tokenIn: bigint, state: BondingCurveState): bigint {
    const newVirtualToken = state.virtualTokenReserves + tokenIn;
    const newVirtualSol =
      (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualToken;
    return state.virtualSolReserves - newVirtualSol;
  }

  calculateAmmBuyOutput(quoteIn: bigint, reserves: PoolReserves): bigint {
    const quoteInAfterFee =
      (quoteIn * (BPS_DENOMINATOR - AMM_FEE_BPS)) / BPS_DENOMINATOR;
    const numerator = reserves.baseAmount * quoteInAfterFee;
    const denominator = reserves.quoteAmount + quoteInAfterFee;
    return numerator / denominator;
  }

  calculateAmmSellOutput(baseIn: bigint, reserves: PoolReserves): bigint {
    const baseInAfterFee =
      (baseIn * (BPS_DENOMINATOR - AMM_FEE_BPS)) / BPS_DENOMINATOR;
    const numerator = reserves.quoteAmount * baseInAfterFee;
    const denominator = reserves.baseAmount + baseInAfterFee;
    return numerator / denominator;
  }

  /* ---------- 价格查询 ---------- */

  async getPriceAndStatus(
    tokenAddr: string,
  ): Promise<{ price: number; completed: boolean }> {
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

  async getAmmPrice(mint: PublicKey): Promise<number> {
    const [poolCreator] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mint.toBuffer()],
      PROGRAM_IDS.PUMP,
    );

    const indexBuffer = new BN(0).toArrayLike(Buffer, "le", 2);
    const [pool] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        indexBuffer,
        poolCreator.toBuffer(),
        mint.toBuffer(),
        SOL_MINT.toBuffer(),
      ],
      PROGRAM_IDS.PUMP_AMM,
    );

    const acc = await this.connection.getAccountInfo(pool);
    if (!acc) throw new Error("Pool not found");

    const poolKeys = parsePoolKeys(acc.data);
    const [baseInfo, quoteInfo] = await Promise.all([
      this.connection.getTokenAccountBalance(poolKeys.poolBaseTokenAccount),
      this.connection.getTokenAccountBalance(poolKeys.poolQuoteTokenAccount),
    ]);

    return quoteInfo.value.uiAmount! / baseInfo.value.uiAmount!;
  }

  /* ---------- 余额查询 ---------- */

  /**
   * 查询代币余额
   * @param tokenAddr - 代币地址（可选），如果不传则返回所有代币
   * @returns 如果传入地址则返回该代币的余额数字，否则返回所有代币的详细信息
   */
  async tokenBalance(tokenAddr?: string): Promise<
    | number
    | Array<{
        mint: string;
        amount: number;
        decimals: number;
        uiAmount: number;
      }>
  > {
    if (tokenAddr) {
      // 查询单个代币
      const mint = new PublicKey(tokenAddr);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { mint },
      );
      return (
        tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ||
        0
      );
    } else {
      // 查询所有代币
      return this.getAllTokenBalances();
    }
  }

  /**
   * 获取账户所有代币余额（仅显示余额 > 0 的）
   * @returns 代币信息数组，包含mint地址、余额等信息
   */
  async getAllTokenBalances(): Promise<
    Array<{ mint: string; amount: number; decimals: number; uiAmount: number }>
  > {
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { programId: TOKEN_PROGRAM_ID },
    );

    const balances = tokenAccounts.value
      .map((account) => {
        const parsed = account.account.data.parsed;
        if (parsed.type !== "account") return null;

        const tokenAmount = parsed.info.tokenAmount;
        if (Number(tokenAmount.amount) === 0) return null; // 跳过余额为0的

        return {
          mint: parsed.info.mint,
          amount: BigInt(tokenAmount.amount),
          decimals: tokenAmount.decimals,
          uiAmount: tokenAmount.uiAmount || 0,
        };
      })
      .filter((item) => item !== null) as Array<{
      mint: string;
      amount: bigint;
      decimals: number;
      uiAmount: number;
    }>;

    // 同时查询 TOKEN_2022_PROGRAM_ID
    const token2022Accounts =
      await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { programId: TOKEN_2022_PROGRAM_ID },
      );

    const token2022Balances = token2022Accounts.value
      .map((account) => {
        const parsed = account.account.data.parsed;
        if (parsed.type !== "account") return null;

        const tokenAmount = parsed.info.tokenAmount;
        if (Number(tokenAmount.amount) === 0) return null; // 跳过余额为0的

        return {
          mint: parsed.info.mint,
          amount: BigInt(tokenAmount.amount),
          decimals: tokenAmount.decimals,
          uiAmount: tokenAmount.uiAmount || 0,
        };
      })
      .filter((item) => item !== null) as Array<{
      mint: string;
      amount: bigint;
      decimals: number;
      uiAmount: number;
    }>;

    // 合并并去重
    const allBalances = [...balances, ...token2022Balances];
    const seen = new Set<string>();
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
        uiAmount: b.uiAmount,
      }));

    return uniqueBalances;
  }

  async solBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / 1e9;
  }

  /* ---------- ATA 管理 ---------- */

  async ensureAta(
    tx: Transaction,
    mint: PublicKey,
    tokenProgram?: PublicKey,
  ): Promise<PublicKey> {
    const program = tokenProgram || TOKEN_2022_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(
      mint,
      this.wallet.publicKey,
      false,
      program,
      ASSOCIATED_TOKEN_PROGRAM_ID,
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
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }

    return ata;
  }

  async ensureWSOLAta(
    tx: Transaction,
    owner: PublicKey,
    mode: "buy" | "sell",
    lamports?: bigint,
  ): Promise<PublicKey> {
    const wsolAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
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
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }

    if (mode === "buy" && lamports) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: wsolAta,
          lamports: Number(lamports),
        }),
      );
      tx.add(createSyncNativeInstruction(wsolAta));
    }

    return wsolAta;
  }

  /* ---------- 交易参数处理 ---------- */

  genPriority(priorityOpt: any): number {
    if (!priorityOpt?.enableRandom || !priorityOpt.randomRange) {
      return priorityOpt.base;
    }
    return (
      priorityOpt.base + Math.floor(Math.random() * priorityOpt.randomRange)
    );
  }

  calcSlippage({ tradeSize, reserve, slippageOpt }: any): number {
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

  splitByMax(total: bigint, max: bigint): bigint[] {
    const chunks: bigint[] = [];
    let remaining = total;

    while (remaining > 0n) {
      const chunk = remaining > max ? max : remaining;
      chunks.push(chunk);
      remaining -= chunk;
    }
    return chunks;
  }

  splitIntoN(total: bigint, n: number): bigint[] {
    const chunks: bigint[] = [];
    const part = total / BigInt(n);
    let remaining = total;

    for (let i = 0; i < n; i++) {
      const chunk = i === n - 1 ? remaining : part;
      chunks.push(chunk);
      remaining -= chunk;
    }
    return chunks;
  }

  /* ---------- 统一交易接口 ---------- */

  /**
   * 自动判断内盘/外盘并执行买入
   * @param useV2 - use buy_v2 instruction (supports USDC quote) instead of legacy buy
   * @param quoteMint - quote mint for V2 (SOL_MINT for SOL-paired, or USDC mint for USDC-paired)
   */
  async autoBuy(
    tokenAddr: string,
    totalSolIn: bigint,
    tradeOpt: TradeOptions,
    useV2: boolean = false,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<TradeResult> {
    const mode = await this.getTradeMode(tokenAddr);
    if (mode === "bonding") {
      if (useV2) {
        return this.buyV2(tokenAddr, totalSolIn, tradeOpt, quoteMint);
      }
      return this.buy(tokenAddr, totalSolIn, tradeOpt);
    } else {
      return this.ammBuy(tokenAddr, totalSolIn, tradeOpt, quoteMint);
    }
  }

  /**
   * 自动判断内盘/外盘并执行卖出
   * @param useV2 - use sell_v2 instruction (supports USDC quote) instead of legacy sell
   * @param quoteMint - quote mint for V2 (SOL_MINT for SOL-paired, or USDC mint for USDC-paired)
   */
  async autoSell(
    tokenAddr: string,
    totalTokenIn: bigint,
    tradeOpt: TradeOptions,
    useV2: boolean = false,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<TradeResult> {
    const mode = await this.getTradeMode(tokenAddr);
    if (mode === "bonding") {
      if (useV2) {
        return this.sellV2(tokenAddr, totalTokenIn, tradeOpt, quoteMint);
      }
      return this.sell(tokenAddr, totalTokenIn, tradeOpt);
    } else {
      return this.ammSell(tokenAddr, totalTokenIn, tradeOpt, quoteMint);
    }
  }

  /* ---------- 内盘交易 ---------- */

  async buy(
    tokenAddr: string,
    totalSolIn: bigint,
    tradeOpt: TradeOptions,
  ): Promise<TradeResult> {
    const mint = new PublicKey(tokenAddr);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);
    const bondingCurveV2 = this.deriveBondingCurveV2(mint);

    if (!this.globalState) await this.loadGlobal();

    const { bonding, state, creator } = await this.loadBonding(mint);
    if (state.complete) throw new Error("Bonding curve already completed");

    const solChunks = this.splitByMax(totalSolIn, tradeOpt.maxSolPerTx);
    const pendingTransactions: PendingTransaction[] = [];
    const failedTransactions: FailedTransaction[] = [];

    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint,
      bonding,
      true,
      tokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP,
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PROGRAM_IDS.PUMP,
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_volume_accumulator"),
        this.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_IDS.PUMP,
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.FEE_CONFIG],
      PROGRAM_IDS.FEE,
    );
    const feeRecipient = this.pickFeeRecipient();

    for (let i = 0; i < solChunks.length; i++) {
      try {
        const solIn = solChunks[i];
        const tokenOut = this.calcBuy(solIn, state);
        const slippageBps = this.calcSlippage({
          tradeSize: solIn,
          reserve: state.virtualSolReserves,
          slippageOpt: tradeOpt.slippage,
        });
        const maxSol = (solIn * BigInt(10_000 + slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
        );

        const userAta = await this.ensureAta(tx, mint, tokenProgram.programId);

        tx.add(
          new TransactionInstruction({
            programId: PROGRAM_IDS.PUMP,
            keys: this.buildBondingBuyKeys({
              global: this.global,
              globalFeeRecipient: this.globalState!.feeRecipient,
              mint,
              bonding,
              associatedBondingCurve,
              userAta,
              wallet: this.wallet.publicKey,
              creatorVault,
              eventAuthority: PROGRAM_IDS.EVENT_AUTHORITY,
              pumpProgram: PROGRAM_IDS.PUMP,
              globalVolumeAccumulator,
              userVolumeAccumulator,
              feeConfig,
              feeProgram: PROGRAM_IDS.FEE,
              bondingCurveV2,
              feeRecipient,
              tokenProgramId: tokenProgram.programId,
            }),
            data: Buffer.concat([
              DISCRIMINATORS.BUY,
              u64(tokenOut),
              u64(maxSol),
            ]),
          }),
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: false,
            maxRetries: 2,
          },
        );

        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i,
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: (e as Error).message,
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  async sell(
    tokenAddr: string,
    totalTokenIn: bigint,
    tradeOpt: TradeOptions,
  ): Promise<TradeResult> {
    const mint = new PublicKey(tokenAddr);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);
    const bondingCurveV2 = this.deriveBondingCurveV2(mint);

    if (!this.globalState) await this.loadGlobal();

    const { bonding, state, creator } = await this.loadBonding(mint);
    if (state.complete) throw new Error("Bonding curve already completed");

    const totalSolOut = this.calcSell(totalTokenIn, state);
    const tokenChunks =
      totalSolOut <= tradeOpt.maxSolPerTx
        ? [totalTokenIn]
        : this.splitIntoN(
            totalTokenIn,
            Number(
              (totalSolOut + tradeOpt.maxSolPerTx - 1n) / tradeOpt.maxSolPerTx,
            ),
          );

    const pendingTransactions: PendingTransaction[] = [];
    const failedTransactions: FailedTransaction[] = [];

    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint,
      bonding,
      true,
      tokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const userAta = getAssociatedTokenAddressSync(
      mint,
      this.wallet.publicKey,
      false,
      tokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP,
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.FEE_CONFIG],
      PROGRAM_IDS.FEE,
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_volume_accumulator"),
        this.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_IDS.PUMP,
    );
    const feeRecipient = this.pickFeeRecipient();

    for (let i = 0; i < tokenChunks.length; i++) {
      try {
        const tokenIn = tokenChunks[i];
        const solOut = this.calcSell(tokenIn, state);
        const slippageBps = this.calcSlippage({
          tradeSize: tokenIn,
          reserve: state.virtualTokenReserves,
          slippageOpt: tradeOpt.slippage,
        });
        const minSol = (solOut * BigInt(10_000 - slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
        );

        tx.add(
          new TransactionInstruction({
            programId: PROGRAM_IDS.PUMP,
            keys: this.buildBondingSellKeys({
              global: this.global,
              globalFeeRecipient: this.globalState!.feeRecipient,
              mint,
              bonding,
              associatedBondingCurve,
              userAta,
              wallet: this.wallet.publicKey,
              creatorVault,
              eventAuthority: PROGRAM_IDS.EVENT_AUTHORITY,
              pumpProgram: PROGRAM_IDS.PUMP,
              feeConfig,
              feeProgram: PROGRAM_IDS.FEE,
              bondingCurveV2,
              feeRecipient,
              isCashbackCoin: !!state.isCashbackCoin,
              userVolumeAccumulator,
              tokenProgramId: tokenProgram.programId,
            }),
            data: Buffer.concat([
              DISCRIMINATORS.SELL,
              u64(tokenIn),
              u64(minSol > 0n ? minSol : 1n),
            ]),
          }),
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
        );
        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i,
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: (e as Error).message,
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  /* ---------- 外盘交易 ---------- */

  async ammBuy(
    tokenAddr: string,
    totalSolIn: bigint,
    tradeOpt: TradeOptions,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<TradeResult> {
    const mint = new PublicKey(tokenAddr);
    const poolInfo = await this.getAmmPoolInfo(mint, quoteMint);
    const reserves = await this.getAmmPoolReserves(poolInfo.poolKeys);
    const solChunks = this.splitByMax(totalSolIn, tradeOpt.maxSolPerTx);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);
    const isSolQuote = quoteMint.equals(SOL_MINT);
    const quoteTokenProgramId = isSolQuote
      ? TOKEN_PROGRAM_ID
      : await this.detectQuoteTokenProgram(quoteMint);
    const pendingTransactions: PendingTransaction[] = [];
    const failedTransactions: FailedTransaction[] = [];

    for (let i = 0; i < solChunks.length; i++) {
      try {
        const solIn = solChunks[i];
        const baseAmountOut = this.calculateAmmBuyOutput(solIn, reserves);
        const slippageBps = this.calcSlippage({
          tradeSize: solIn,
          reserve: reserves.quoteAmount,
          slippageOpt: tradeOpt.slippage,
        });
        const maxQuoteIn = (solIn * BigInt(10_000 + slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
        );

        const userBaseAta = await this.ensureAta(
          tx,
          poolInfo.poolKeys.baseMint,
          tokenProgram.programId,
        );
        const userQuoteAta = isSolQuote
          ? await this.ensureWSOLAta(
              tx,
              this.wallet.publicKey,
              "buy",
              maxQuoteIn,
            )
          : await this.ensureAta(tx, quoteMint, quoteTokenProgramId);

        const buyIx = this.createAmmBuyInstruction(
          poolInfo,
          userBaseAta,
          userQuoteAta,
          baseAmountOut,
          maxQuoteIn,
          tokenProgram.programId,
        );

        tx.add(buyIx);
        if (isSolQuote) {
          tx.add(
            createCloseAccountInstruction(
              userQuoteAta,
              this.wallet.publicKey,
              this.wallet.publicKey,
            ),
          );
        }

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: false,
            maxRetries: 2,
          },
        );

        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i,
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: (e as Error).message,
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  async ammSell(
    tokenAddr: string,
    totalTokenIn: bigint,
    tradeOpt: TradeOptions,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<TradeResult> {
    const mint = new PublicKey(tokenAddr);
    const poolInfo = await this.getAmmPoolInfo(mint, quoteMint);
    const reserves = await this.getAmmPoolReserves(poolInfo.poolKeys);
    const totalSolOut = this.calculateAmmSellOutput(totalTokenIn, reserves);
    const tokenProgram = await this.detectTokenProgram(tokenAddr);
    const isSolQuote = quoteMint.equals(SOL_MINT);
    const quoteTokenProgramId = isSolQuote
      ? TOKEN_PROGRAM_ID
      : await this.detectQuoteTokenProgram(quoteMint);
    const tokenChunks =
      totalSolOut <= tradeOpt.maxSolPerTx
        ? [totalTokenIn]
        : this.splitIntoN(
            totalTokenIn,
            Number(
              (totalSolOut + tradeOpt.maxSolPerTx - 1n) / tradeOpt.maxSolPerTx,
            ),
          );

    const pendingTransactions: PendingTransaction[] = [];
    const failedTransactions: FailedTransaction[] = [];

    for (let i = 0; i < tokenChunks.length; i++) {
      try {
        const tokenIn = tokenChunks[i];
        const solOut = this.calculateAmmSellOutput(tokenIn, reserves);
        const slippageBps = this.calcSlippage({
          tradeSize: tokenIn,
          reserve: reserves.baseAmount,
          slippageOpt: tradeOpt.slippage,
        });
        const minQuoteOut = (solOut * BigInt(10_000 - slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
        );

        const userBaseAta = await this.ensureAta(
          tx,
          poolInfo.poolKeys.baseMint,
          tokenProgram.programId,
        );
        const userQuoteAta = isSolQuote
          ? await this.ensureWSOLAta(tx, this.wallet.publicKey, "sell")
          : await this.ensureAta(tx, quoteMint, quoteTokenProgramId);

        const sellIx = this.createAmmSellInstruction(
          poolInfo,
          userBaseAta,
          userQuoteAta,
          tokenIn,
          minQuoteOut,
          tokenProgram.programId,
        );

        tx.add(sellIx);
        if (isSolQuote) {
          tx.add(
            createCloseAccountInstruction(
              userQuoteAta,
              this.wallet.publicKey,
              this.wallet.publicKey,
            ),
          );
        }

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: false,
            maxRetries: 2,
          },
        );

        pendingTransactions.push({
          signature,
          lastValidBlockHeight,
          index: i,
        });
      } catch (e) {
        failedTransactions.push({
          index: i,
          error: (e as Error).message,
        });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  /* ---------- AMM 池信息 ---------- */

  async getAmmPoolInfo(
    mint: PublicKey,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<PoolInfo> {
    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mint.toBuffer()],
      PROGRAM_IDS.PUMP,
    );

    const [pool] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new BN(0).toArrayLike(Buffer, "le", 2),
        poolAuthority.toBuffer(),
        mint.toBuffer(),
        quoteMint.toBuffer(),
      ],
      PROGRAM_IDS.PUMP_AMM,
    );

    const acc = await this.connection.getAccountInfo(pool);
    if (!acc) throw new Error("AMM pool not found");

    const poolKeys = parsePoolKeys(acc.data);

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")],
      PROGRAM_IDS.PUMP_AMM,
    );

    const globalConfigAcc =
      await this.connection.getAccountInfo(globalConfigPda);
    if (!globalConfigAcc) throw new Error("Global config not found");

    const globalConfig = this.parseAmmGlobalConfig(
      globalConfigAcc.data,
      globalConfigPda,
    );

    return { pool, poolAuthority, poolKeys, globalConfig };
  }

  parseAmmGlobalConfig(data: Buffer, address: PublicKey) {
    let offset = 8;

    const admin = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    offset += 8;
    offset += 8;
    offset += 1;

    const protocolFeeRecipients: PublicKey[] = [];
    for (let i = 0; i < 8; i++) {
      protocolFeeRecipients.push(
        new PublicKey(data.slice(offset, offset + 32)),
      );
      offset += 32;
    }

    return { address, admin, protocolFeeRecipients };
  }

  async getAmmPoolReserves(poolKeys: any): Promise<PoolReserves> {
    const [baseInfo, quoteInfo] = await Promise.all([
      this.connection.getTokenAccountBalance(poolKeys.poolBaseTokenAccount),
      this.connection.getTokenAccountBalance(poolKeys.poolQuoteTokenAccount),
    ]);

    return {
      baseAmount: BigInt(baseInfo.value.amount),
      quoteAmount: BigInt(quoteInfo.value.amount),
      baseDecimals: baseInfo.value.decimals,
      quoteDecimals: quoteInfo.value.decimals,
    };
  }

  deriveAmmPoolV2(baseMint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool-v2"), baseMint.toBuffer()],
      PROGRAM_IDS.PUMP_AMM,
    )[0];
  }

  /* ---------- AMM 指令构建 ---------- */

  createAmmBuyInstruction(
    poolInfo: PoolInfo,
    userBaseAta: PublicKey,
    userQuoteAta: PublicKey,
    baseAmountOut: bigint,
    maxQuoteAmountIn: bigint,
    tokenProgramId: PublicKey,
  ): TransactionInstruction {
    const { pool, poolKeys, globalConfig } = poolInfo;
    const poolV2 = this.deriveAmmPoolV2(poolKeys.baseMint);

    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PROGRAM_IDS.PUMP_AMM,
    );

    const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), poolKeys.coinCreator.toBuffer()],
      PROGRAM_IDS.PUMP_AMM,
    );

    const coinCreatorVaultAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      coinCreatorVaultAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PROGRAM_IDS.PUMP_AMM,
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_volume_accumulator"),
        this.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_IDS.PUMP_AMM,
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.AMM_FEE_CONFIG],
      PROGRAM_IDS.FEE,
    );

    const protocolFeeRecipient = globalConfig.protocolFeeRecipients[0];
    const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      SOL_MINT,
      protocolFeeRecipient,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const newFeeRecipient = this.pickFeeRecipient();
    const newFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      poolKeys.quoteMint,
      newFeeRecipient,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const remainingKeys = [];
    if (poolKeys.isCashbackCoin) {
      const userVolumeAccumulatorWsolAta = getAssociatedTokenAddressSync(
        SOL_MINT,
        userVolumeAccumulator,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      remainingKeys.push({
        pubkey: userVolumeAccumulatorWsolAta,
        isSigner: false,
        isWritable: true,
      });
    }
    remainingKeys.push({ pubkey: poolV2, isSigner: false, isWritable: false });
    remainingKeys.push(
      { pubkey: newFeeRecipient, isSigner: false, isWritable: false },
      {
        pubkey: newFeeRecipientTokenAccount,
        isSigner: false,
        isWritable: true,
      },
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
        {
          pubkey: poolKeys.poolBaseTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: poolKeys.poolQuoteTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },
        {
          pubkey: protocolFeeRecipientTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.PUMP_AMM, isSigner: false, isWritable: false },
        { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
        {
          pubkey: coinCreatorVaultAuthority,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.FEE, isSigner: false, isWritable: false },
        ...remainingKeys,
      ],
      data: Buffer.concat([
        DISCRIMINATORS.BUY,
        u64(baseAmountOut),
        u64(maxQuoteAmountIn),
        Buffer.from([1, 1]),
      ]),
    });
  }

  createAmmSellInstruction(
    poolInfo: PoolInfo,
    userBaseAta: PublicKey,
    userQuoteAta: PublicKey,
    baseAmountIn: bigint,
    minQuoteAmountOut: bigint,
    tokenProgramId: PublicKey,
  ): TransactionInstruction {
    const { pool, poolKeys, globalConfig } = poolInfo;
    const poolV2 = this.deriveAmmPoolV2(poolKeys.baseMint);

    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PROGRAM_IDS.PUMP_AMM,
    );

    const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), poolKeys.coinCreator.toBuffer()],
      PROGRAM_IDS.PUMP_AMM,
    );

    const coinCreatorVaultAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      coinCreatorVaultAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.AMM_FEE_CONFIG],
      PROGRAM_IDS.FEE,
    );

    const protocolFeeRecipient = globalConfig.protocolFeeRecipients[0];
    const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      SOL_MINT,
      protocolFeeRecipient,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const newFeeRecipient = this.pickFeeRecipient();
    const newFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      poolKeys.quoteMint,
      newFeeRecipient,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_volume_accumulator"),
        this.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_IDS.PUMP_AMM,
    );

    const userVolumeAccumulatorWsolAta = getAssociatedTokenAddressSync(
      SOL_MINT,
      userVolumeAccumulator,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const remainingKeys = [];
    if (poolKeys.isCashbackCoin) {
      remainingKeys.push(
        {
          pubkey: userVolumeAccumulatorWsolAta,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      );
    }
    remainingKeys.push({ pubkey: poolV2, isSigner: false, isWritable: false });
    remainingKeys.push(
      { pubkey: newFeeRecipient, isSigner: false, isWritable: false },
      {
        pubkey: newFeeRecipientTokenAccount,
        isSigner: false,
        isWritable: true,
      },
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
        {
          pubkey: poolKeys.poolBaseTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: poolKeys.poolQuoteTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },
        {
          pubkey: protocolFeeRecipientTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.PUMP_AMM, isSigner: false, isWritable: false },
        { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
        {
          pubkey: coinCreatorVaultAuthority,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_IDS.FEE, isSigner: false, isWritable: false },
        ...remainingKeys,
      ],
      data: Buffer.concat([
        DISCRIMINATORS.SELL,
        u64(baseAmountIn),
        u64(minQuoteAmountOut > 0n ? minQuoteAmountOut : 1n),
      ]),
    });
  }

  /* ---------- V2 指令账户构建 ---------- */

  /**
   * Build accounts for buy_v2 instruction (27 accounts)
   * Ref: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/BUY.md
   */
  private buildBondingBuyV2Keys(args: {
    global: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    baseTokenProgram: PublicKey;
    quoteTokenProgram: PublicKey;
    feeRecipient: PublicKey;
    associatedQuoteFeeRecipient: PublicKey;
    buybackFeeRecipient: PublicKey;
    associatedQuoteBuybackFeeRecipient: PublicKey;
    bondingCurve: PublicKey;
    associatedBaseBondingCurve: PublicKey;
    associatedQuoteBondingCurve: PublicKey;
    user: PublicKey;
    associatedBaseUser: PublicKey;
    associatedQuoteUser: PublicKey;
    creatorVault: PublicKey;
    associatedCreatorVault: PublicKey;
    sharingConfig: PublicKey;
    globalVolumeAccumulator: PublicKey;
    userVolumeAccumulator: PublicKey;
    associatedUserVolumeAccumulator: PublicKey;
    feeConfig: PublicKey;
    feeProgram: PublicKey;
    eventAuthority: PublicKey;
    pumpProgram: PublicKey;
  }): AccountMeta[] {
    return [
      { pubkey: args.global, isSigner: false, isWritable: false },
      { pubkey: args.baseMint, isSigner: false, isWritable: false },
      { pubkey: args.quoteMint, isSigner: false, isWritable: false },
      { pubkey: args.baseTokenProgram, isSigner: false, isWritable: false },
      { pubkey: args.quoteTokenProgram, isSigner: false, isWritable: false },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: args.feeRecipient, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedQuoteFeeRecipient,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.buybackFeeRecipient, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedQuoteBuybackFeeRecipient,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.bondingCurve, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedBaseBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: args.associatedQuoteBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: args.associatedBaseUser, isSigner: false, isWritable: true },
      { pubkey: args.associatedQuoteUser, isSigner: false, isWritable: true },
      { pubkey: args.creatorVault, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedCreatorVault,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.sharingConfig, isSigner: false, isWritable: false },
      {
        pubkey: args.globalVolumeAccumulator,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: args.userVolumeAccumulator, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedUserVolumeAccumulator,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.feeConfig, isSigner: false, isWritable: false },
      { pubkey: args.feeProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: args.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: args.pumpProgram, isSigner: false, isWritable: false },
    ];
  }

  /**
   * Build accounts for sell_v2 instruction (26 accounts)
   * Ref: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/SELL.md
   */
  private buildBondingSellV2Keys(args: {
    global: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    baseTokenProgram: PublicKey;
    quoteTokenProgram: PublicKey;
    feeRecipient: PublicKey;
    associatedQuoteFeeRecipient: PublicKey;
    buybackFeeRecipient: PublicKey;
    associatedQuoteBuybackFeeRecipient: PublicKey;
    bondingCurve: PublicKey;
    associatedBaseBondingCurve: PublicKey;
    associatedQuoteBondingCurve: PublicKey;
    user: PublicKey;
    associatedBaseUser: PublicKey;
    associatedQuoteUser: PublicKey;
    creatorVault: PublicKey;
    associatedCreatorVault: PublicKey;
    sharingConfig: PublicKey;
    userVolumeAccumulator: PublicKey;
    associatedUserVolumeAccumulator: PublicKey;
    feeConfig: PublicKey;
    feeProgram: PublicKey;
    eventAuthority: PublicKey;
    pumpProgram: PublicKey;
  }): AccountMeta[] {
    return [
      { pubkey: args.global, isSigner: false, isWritable: false },
      { pubkey: args.baseMint, isSigner: false, isWritable: false },
      { pubkey: args.quoteMint, isSigner: false, isWritable: false },
      { pubkey: args.baseTokenProgram, isSigner: false, isWritable: false },
      { pubkey: args.quoteTokenProgram, isSigner: false, isWritable: false },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: args.feeRecipient, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedQuoteFeeRecipient,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.buybackFeeRecipient, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedQuoteBuybackFeeRecipient,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.bondingCurve, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedBaseBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: args.associatedQuoteBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: args.associatedBaseUser, isSigner: false, isWritable: true },
      { pubkey: args.associatedQuoteUser, isSigner: false, isWritable: true },
      { pubkey: args.creatorVault, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedCreatorVault,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.sharingConfig, isSigner: false, isWritable: false },
      { pubkey: args.userVolumeAccumulator, isSigner: false, isWritable: true },
      {
        pubkey: args.associatedUserVolumeAccumulator,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.feeConfig, isSigner: false, isWritable: false },
      { pubkey: args.feeProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: args.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: args.pumpProgram, isSigner: false, isWritable: false },
    ];
  }

  /* ---------- V2 交易 ---------- */

  /**
   * Buy using buy_v2 instruction (supports both SOL-paired and USDC-paired coins)
   * For SOL-paired coins: quoteMint = SOL_MINT, quoteTokenProgram = TOKEN_PROGRAM_ID
   * For USDC-paired coins: quoteMint = USDC mint, quoteTokenProgram = TOKEN_PROGRAM_ID
   */
  async buyV2(
    tokenAddr: string,
    totalQuoteIn: bigint,
    tradeOpt: TradeOptions,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<TradeResult> {
    const baseMint = new PublicKey(tokenAddr);
    const baseTokenProgram = await this.detectTokenProgram(tokenAddr);
    const quoteTokenProgramId = quoteMint.equals(SOL_MINT)
      ? TOKEN_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    if (!this.globalState) await this.loadGlobal();

    const { bonding, state, creator } = await this.loadBonding(baseMint);
    if (state.complete) throw new Error("Bonding curve already completed");

    const solEquivalent = quoteMint.equals(SOL_MINT) ? totalQuoteIn : 0n;
    const quoteChunks =
      solEquivalent > 0n
        ? this.splitByMax(solEquivalent, tradeOpt.maxSolPerTx)
        : this.splitByMax(totalQuoteIn, tradeOpt.maxSolPerTx);

    const pendingTransactions: PendingTransaction[] = [];
    const failedTransactions: FailedTransaction[] = [];

    // Pre-compute PDAs
    const associatedBaseBondingCurve = getAssociatedTokenAddressSync(
      baseMint,
      bonding,
      true,
      baseTokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const associatedQuoteBondingCurve = getAssociatedTokenAddressSync(
      quoteMint,
      bonding,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP,
    );
    const associatedCreatorVault = getAssociatedTokenAddressSync(
      quoteMint,
      creatorVault,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PROGRAM_IDS.PUMP,
    );
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_volume_accumulator"),
        this.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_IDS.PUMP,
    );
    const associatedUserVolumeAccumulator = getAssociatedTokenAddressSync(
      quoteMint,
      userVolumeAccumulator,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.FEE_CONFIG],
      PROGRAM_IDS.FEE,
    );

    const sharingConfig = this.getSharingConfigPda(baseMint);
    const feeRecipient = this.pickFeeRecipient();
    const associatedQuoteFeeRecipient = getAssociatedTokenAddressSync(
      quoteMint,
      feeRecipient,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const buybackFeeRecipient = this.pickBuybackFeeRecipient();
    const associatedQuoteBuybackFeeRecipient = getAssociatedTokenAddressSync(
      quoteMint,
      buybackFeeRecipient,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const associatedQuoteUser = getAssociatedTokenAddressSync(
      quoteMint,
      this.wallet.publicKey,
      false,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    for (let i = 0; i < quoteChunks.length; i++) {
      try {
        const quoteIn = quoteChunks[i];
        const tokenOut = this.calcBuy(quoteIn, state);
        const slippageBps = this.calcSlippage({
          tradeSize: quoteIn,
          reserve: state.virtualSolReserves,
          slippageOpt: tradeOpt.slippage,
        });
        const maxQuoteCost = (quoteIn * BigInt(10_000 + slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
        );

        // For SOL-paired coins, need wSOL ATA for the user's quote account
        if (quoteMint.equals(SOL_MINT)) {
          await this.ensureWSOLAta(
            tx,
            this.wallet.publicKey,
            "buy",
            maxQuoteCost,
          );
        } else {
          // For non-SOL quote (e.g. USDC), ensure user has the quote token ATA
          const userQuoteAta = getAssociatedTokenAddressSync(
            quoteMint,
            this.wallet.publicKey,
            false,
            quoteTokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          const acc = await this.connection.getAccountInfo(userQuoteAta);
          if (!acc) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                this.wallet.publicKey,
                userQuoteAta,
                this.wallet.publicKey,
                quoteMint,
                quoteTokenProgramId,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
          }
        }

        const userBaseAta = await this.ensureAta(
          tx,
          baseMint,
          baseTokenProgram.programId,
        );

        tx.add(
          new TransactionInstruction({
            programId: PROGRAM_IDS.PUMP,
            keys: this.buildBondingBuyV2Keys({
              global: this.global,
              baseMint,
              quoteMint,
              baseTokenProgram: baseTokenProgram.programId,
              quoteTokenProgram: quoteTokenProgramId,
              feeRecipient,
              associatedQuoteFeeRecipient,
              buybackFeeRecipient,
              associatedQuoteBuybackFeeRecipient,
              bondingCurve: bonding,
              associatedBaseBondingCurve,
              associatedQuoteBondingCurve,
              user: this.wallet.publicKey,
              associatedBaseUser: userBaseAta,
              associatedQuoteUser,
              creatorVault,
              associatedCreatorVault,
              sharingConfig,
              globalVolumeAccumulator,
              userVolumeAccumulator,
              associatedUserVolumeAccumulator,
              feeConfig,
              feeProgram: PROGRAM_IDS.FEE,
              eventAuthority: PROGRAM_IDS.EVENT_AUTHORITY,
              pumpProgram: PROGRAM_IDS.PUMP,
            }),
            data: Buffer.concat([
              DISCRIMINATORS.BUY_V2,
              u64(tokenOut),
              u64(maxQuoteCost),
            ]),
          }),
        );

        // Close wSOL ATA after buy for SOL-paired coins
        if (quoteMint.equals(SOL_MINT)) {
          const wsolAta = getAssociatedTokenAddressSync(
            SOL_MINT,
            this.wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          tx.add(
            createCloseAccountInstruction(
              wsolAta,
              this.wallet.publicKey,
              this.wallet.publicKey,
            ),
          );
        }

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: false,
            maxRetries: 2,
          },
        );

        pendingTransactions.push({ signature, lastValidBlockHeight, index: i });
      } catch (e) {
        failedTransactions.push({ index: i, error: (e as Error).message });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  /**
   * Sell using sell_v2 instruction (supports both SOL-paired and USDC-paired coins)
   */
  async sellV2(
    tokenAddr: string,
    totalTokenIn: bigint,
    tradeOpt: TradeOptions,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<TradeResult> {
    const baseMint = new PublicKey(tokenAddr);
    const baseTokenProgram = await this.detectTokenProgram(tokenAddr);
    const quoteTokenProgramId = quoteMint.equals(SOL_MINT)
      ? TOKEN_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    if (!this.globalState) await this.loadGlobal();

    const { bonding, state, creator } = await this.loadBonding(baseMint);
    if (state.complete) throw new Error("Bonding curve already completed");

    const totalQuoteOut = this.calcSell(totalTokenIn, state);
    const tokenChunks =
      totalQuoteOut <= tradeOpt.maxSolPerTx
        ? [totalTokenIn]
        : this.splitIntoN(
            totalTokenIn,
            Number(
              (totalQuoteOut + tradeOpt.maxSolPerTx - 1n) /
                tradeOpt.maxSolPerTx,
            ),
          );

    const pendingTransactions: PendingTransaction[] = [];
    const failedTransactions: FailedTransaction[] = [];

    // Pre-compute PDAs
    const associatedBaseBondingCurve = getAssociatedTokenAddressSync(
      baseMint,
      bonding,
      true,
      baseTokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const associatedQuoteBondingCurve = getAssociatedTokenAddressSync(
      quoteMint,
      bonding,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP,
    );
    const associatedCreatorVault = getAssociatedTokenAddressSync(
      quoteMint,
      creatorVault,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_volume_accumulator"),
        this.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_IDS.PUMP,
    );
    const associatedUserVolumeAccumulator = getAssociatedTokenAddressSync(
      quoteMint,
      userVolumeAccumulator,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), SEEDS.FEE_CONFIG],
      PROGRAM_IDS.FEE,
    );

    const sharingConfig = this.getSharingConfigPda(baseMint);
    const feeRecipient = this.pickFeeRecipient();
    const associatedQuoteFeeRecipient = getAssociatedTokenAddressSync(
      quoteMint,
      feeRecipient,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const buybackFeeRecipient = this.pickBuybackFeeRecipient();
    const associatedQuoteBuybackFeeRecipient = getAssociatedTokenAddressSync(
      quoteMint,
      buybackFeeRecipient,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const associatedQuoteUser = getAssociatedTokenAddressSync(
      quoteMint,
      this.wallet.publicKey,
      false,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const userBaseAta = getAssociatedTokenAddressSync(
      baseMint,
      this.wallet.publicKey,
      false,
      baseTokenProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    for (let i = 0; i < tokenChunks.length; i++) {
      try {
        const tokenIn = tokenChunks[i];
        const quoteOut = this.calcSell(tokenIn, state);
        const slippageBps = this.calcSlippage({
          tradeSize: tokenIn,
          reserve: state.virtualTokenReserves,
          slippageOpt: tradeOpt.slippage,
        });
        const minQuoteOut = (quoteOut * BigInt(10_000 - slippageBps)) / 10_000n;
        const priority = this.genPriority(tradeOpt.priority);

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
        );

        // For non-SOL quotes, ensure user has the quote token ATA (to receive proceeds)
        if (!quoteMint.equals(SOL_MINT)) {
          const userQuoteAta = getAssociatedTokenAddressSync(
            quoteMint,
            this.wallet.publicKey,
            false,
            quoteTokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          const acc = await this.connection.getAccountInfo(userQuoteAta);
          if (!acc) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                this.wallet.publicKey,
                userQuoteAta,
                this.wallet.publicKey,
                quoteMint,
                quoteTokenProgramId,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
          }
        }

        tx.add(
          new TransactionInstruction({
            programId: PROGRAM_IDS.PUMP,
            keys: this.buildBondingSellV2Keys({
              global: this.global,
              baseMint,
              quoteMint,
              baseTokenProgram: baseTokenProgram.programId,
              quoteTokenProgram: quoteTokenProgramId,
              feeRecipient,
              associatedQuoteFeeRecipient,
              buybackFeeRecipient,
              associatedQuoteBuybackFeeRecipient,
              bondingCurve: bonding,
              associatedBaseBondingCurve,
              associatedQuoteBondingCurve,
              user: this.wallet.publicKey,
              associatedBaseUser: userBaseAta,
              associatedQuoteUser,
              creatorVault,
              associatedCreatorVault,
              sharingConfig,
              userVolumeAccumulator,
              associatedUserVolumeAccumulator,
              feeConfig,
              feeProgram: PROGRAM_IDS.FEE,
              eventAuthority: PROGRAM_IDS.EVENT_AUTHORITY,
              pumpProgram: PROGRAM_IDS.PUMP,
            }),
            data: Buffer.concat([
              DISCRIMINATORS.SELL_V2,
              u64(tokenIn),
              u64(minQuoteOut > 0n ? minQuoteOut : 1n),
            ]),
          }),
        );

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);

        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
        );
        pendingTransactions.push({ signature, lastValidBlockHeight, index: i });
      } catch (e) {
        failedTransactions.push({ index: i, error: (e as Error).message });
      }
    }

    return { pendingTransactions, failedTransactions };
  }

  /* ---------- Collect Creator Fee V2 ---------- */

  /**
   * Collect creator fees from bonding curve creator vault (collect_creator_fee_v2)
   * Ref: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md
   */
  async collectCreatorFeeV2(
    creator: PublicKey,
    quoteMint: PublicKey = SOL_MINT,
  ): Promise<string> {
    const quoteTokenProgramId = quoteMint.equals(SOL_MINT)
      ? TOKEN_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PROGRAM_IDS.PUMP,
    );

    const creatorTokenAccount = getAssociatedTokenAddressSync(
      quoteMint,
      creator,
      false,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const creatorVaultTokenAccount = getAssociatedTokenAddressSync(
      quoteMint,
      creatorVault,
      true,
      quoteTokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PROGRAM_IDS.PUMP,
    );

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      new TransactionInstruction({
        programId: PROGRAM_IDS.PUMP,
        keys: [
          { pubkey: creator, isSigner: false, isWritable: false },
          { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
          { pubkey: creatorVault, isSigner: false, isWritable: true },
          {
            pubkey: creatorVaultTokenAccount,
            isSigner: false,
            isWritable: true,
          },
          { pubkey: quoteMint, isSigner: false, isWritable: false },
          { pubkey: quoteTokenProgramId, isSigner: false, isWritable: false },
          {
            pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: eventAuthority, isSigner: false, isWritable: false },
          { pubkey: PROGRAM_IDS.PUMP, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.COLLECT_CREATOR_FEE_V2,
      }),
    );

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.wallet.publicKey;
    tx.sign(this.wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.confirmTransactionWithPolling(signature, lastValidBlockHeight);
    return signature;
  }

  /* ---------- 交易确认 ---------- */

  async confirmTransactionWithPolling(
    signature: string,
    lastValidBlockHeight: number,
    maxAttempts: number = 5,
    delayMs: number = 2000,
  ): Promise<string> {
    console.log("✅ 交易已发送:", signature);
    console.log("🔗 查看交易: https://solscan.io/tx/" + signature);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      try {
        console.log(`🔍 检查交易状态 (${attempt}/${maxAttempts})...`);

        const txInfo = await this.connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (txInfo) {
          if (txInfo.meta?.err) {
            console.error("❌ 交易失败:", txInfo.meta.err);
            throw new Error("交易失败: " + JSON.stringify(txInfo.meta.err));
          }

          console.log("✅ 交易已确认!");
          return signature;
        }

        const currentBlockHeight =
          await this.connection.getBlockHeight("finalized");
        if (currentBlockHeight > lastValidBlockHeight) {
          console.log("⚠️ 交易已过期（超过有效区块高度）");
          throw new Error("交易过期：未在有效区块高度内确认");
        }
      } catch (error) {
        const err = error as Error;
        if (
          err.message?.includes("交易失败") ||
          err.message?.includes("交易过期")
        ) {
          throw error;
        }
        console.log(`⚠️ 查询出错，继续重试: ${err.message}`);
      }
    }

    throw new Error(
      `交易确认超时（已尝试 ${maxAttempts} 次），签名: ${signature}。请手动检查交易状态。`,
    );
  }

  /* ---------- 事件监听 ---------- */

  listenTrades(
    callback: (event: TradeEvent) => void,
    mintFilter?: PublicKey | null,
  ) {
    return this.connection.onLogs(
      PROGRAM_IDS.PUMP,
      (log) => {
        for (const logLine of log.logs) {
          if (!logLine.startsWith("Program data: ")) continue;

          const buf = Buffer.from(
            logLine.replace("Program data: ", ""),
            "base64",
          );

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
            signature: log.signature,
          });
        }
      },
      "confirmed",
    );
  }

  /* ---------- 元数据查询 ---------- */

  async fetchMeta(tokenAddr: string): Promise<MetadataInfo | null> {
    const mint = new PublicKey(tokenAddr);

    try {
      const metadata = await getTokenMetadata(
        this.connection,
        mint,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );

      return {
        name: metadata?.name || "",
        symbol: metadata?.symbol || "",
        uri: metadata?.uri || "",
      };
    } catch (e) {
      const metadataPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          PROGRAM_IDS.METADATA.toBuffer(),
          mint.toBuffer(),
        ],
        PROGRAM_IDS.METADATA,
      )[0];

      const acc = await this.connection.getAccountInfo(metadataPda);
      if (!acc) return null;

      const meta = parseMetadataAccount(acc.data);

      return {
        name: meta?.name?.replace(/\u0000/g, "") || "",
        symbol: meta?.symbol?.replace(/\u0000/g, "") || "",
        uri: meta?.uri?.replace(/\u0000/g, "") || "",
      };
    }
  }

  // 公开wallet方法
  getWallet() {
    return this.wallet;
  }

  getConnection() {
    return this.connection;
  }

  /**
   * 清除token program缓存
   */
  clearTokenProgramCache(tokenAddr: string) {
    if (tokenAddr) {
      this.tokenProgramCache.delete(tokenAddr);
    } else {
      this.tokenProgramCache.clear();
    }
  }

  /**
   * 获取缓存的token program信息
   */
  getCachedTokenProgram(tokenAddr: string) {
    return this.tokenProgramCache.get(tokenAddr);
  }
}

// 导出类型
export type {
  TradeOptions,
  PendingTransaction,
  FailedTransaction,
  TradeResult,
  BondingCurveState,
  BondingInfo,
  PoolReserves,
  TradeEvent,
  GlobalState,
  TokenProgramType,
  PoolInfo,
  MetadataInfo,
};

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";

// Lightweight Bonk interface shim:
// - Loads a Bonk idl from a URL and exposes a planner for bonk buy operations.
// - The planner returns a TransactionInstruction plan based on the idl, without
//  filling in the on-chain accounts (the caller must provide the actual PDAs).

type IdlInstructionAccount = {
  name: string;
  signer?: boolean;
  writable?: boolean;
};

type IdlInstruction = {
  name: string;
  discriminator?: number[];
  accounts: IdlInstructionAccount[];
  args?: any[];
};

export interface BonkInstructionPlan {
  programId: PublicKey;
  name: string;
  discriminator: Buffer;
  accounts: { name: string; isSigner: boolean; isWritable: boolean }[];
  data: Buffer;
}

export class BonkTrader {
  private connection: Connection;
  private wallet: any;
  private bonkProgramId?: PublicKey;
  private idl?: any;

  // Optional: default Bonk IDL URLs (two modes: external Raydium AMM and internal Launchlab)
  private ammIdlUrl: string | null = null;
  private launchlabIdlUrl: string | null = null;

  constructor(rpc: string, privateKey: string) {
    this.connection = new Connection(rpc, "confirmed");
    // Breach安全：私钥需要从外部注入，这里仅用于演示模式
    // 直接从 base58 解码硬编码私钥是危险的，生产请通过环境变量注入
    this.wallet = Keypair.fromSecretKey(
      Buffer.from(bs58.decode(privateKey)) as any,
    );
    // 预置 Bonk 的两类 IDL URL，便于快速演示与开发
    this.ammIdlUrl =
      "https://raw.githubusercontent.com/chainstacklabs/pumpfun-bonkfun-bot/refs/heads/main/idl/raydium_amm_idl.json";
    this.launchlabIdlUrl =
      "https://raw.githubusercontent.com/chainstacklabs/pumpfun-bonkfun-bot/refs/heads/main/idl/raydium_launchlab_idl.json";
  }

  // Helpers: fetch JSON safely (node compatibility without global fetch)
  private async fetchJson(url: string): Promise<any> {
    const urlObj = new URL(url);
    const https = await import("https");
    const httpModule = https as any;
    return new Promise((resolve, reject) => {
      httpModule
        .get(urlObj, (resp: any) => {
          let data = "";
          resp.on("data", (chunk: any) => (data += chunk));
          resp.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", (err: any) => {
          reject(err);
        });
    });
  }

  // Load external Bonk AMM IDL to determine programId and discriminator data
  async loadAmmIdl(url?: string): Promise<PublicKey> {
    const idlUrl = url ?? this.ammIdlUrl;
    if (!idlUrl) throw new Error("Bonk Amm IDL URL not configured");
    const idl = await this.fetchJson(idlUrl);
    this.idl = idl;
    // Some IDLs provide the program address at `address` or `programId` field
    const addr = (idl as any).address || (idl as any).programId || null;
    if (!addr) {
      // Try to infer from no address: fail fast
      throw new Error("Bonk Amm IDL missing program address");
    }
    this.bonkProgramId = new PublicKey(addr);
    return this.bonkProgramId;
  }

  // Load internal Bonk Launchlab IDL
  async loadLaunchlabIdl(url?: string): Promise<PublicKey> {
    const idlUrl = url ?? this.launchlabIdlUrl;
    if (!idlUrl) throw new Error("Bonk Launchlab IDL URL not configured");
    const idl = await this.fetchJson(idlUrl);
    this.idl = idl;
    const addr = (idl as any).address || null;
    if (!addr) throw new Error("Bonk Launchlab IDL missing program address");
    this.bonkProgramId = new PublicKey(addr);
    return this.bonkProgramId;
  }

  // Build a plan for a specific instruction from the loaded IDL
  private buildPlan(
    instructionName: string,
    args: bigint | number | undefined,
    tokenAddr?: string,
  ): BonkInstructionPlan {
    if (!this.idl)
      throw new Error(
        "IDL not loaded. Call loadAmmIdl/loadLaunchlabIdl first.",
      );
    const programId = this.bonkProgramId as PublicKey;
    const ids: IdlInstruction[] = this.idl.instructions;
    const ins = ids.find((i: IdlInstruction) => i.name === instructionName);
    if (!ins)
      throw new Error(`Instruction ${instructionName} not found in IDL`);

    const discriminator = Buffer.from(ins.discriminator ?? []);
    // Prepare data payload from args if provided. Expect 3 u64 args for buy_exact_in / buy_exact_out.
    // We will support both 3 args (in/out, min or max, share_rate) depending on usage.
    const dataParts: Buffer[] = [];
    if (args !== undefined) {
      const v = BigInt(args as any);
      dataParts.push(this.u64(v));
    }
    // For safety, always keep data length consistent with 4 fields when using 3 u64 args
    if (instructionName === "buy_exact_in") {
      // amount_in, minimum_amount_out, share_fee_rate -> 3 x u64
      // Caller should pass amount_in as first arg and rely on default handling for rest in actual impl.
    }

    const data = Buffer.concat([
      discriminator,
      ...(dataParts.length ? dataParts : []),
    ]);

    // Map accounts by name from IDL to a stable shape; pubkeys left undefined for caller to fill
    const accs: { name: string; isSigner: boolean; isWritable: boolean }[] = (
      ins.accounts || []
    ).map((a: IdlInstructionAccount) => {
      return {
        name: a.name,
        isSigner: !!a.signer,
        isWritable: !!a.writable,
      };
    });

    return {
      programId,
      name: ins.name,
      discriminator,
      accounts: accs,
      data: data,
    };
  }

  // Public helper: plan a Bonk buy with exact input amount
  async planBonkBuyExactIn(
    tokenAddr: string,
    amountIn: bigint,
    minimumOut: bigint,
    shareFeeRate: bigint,
  ): Promise<BonkInstructionPlan> {
    // Build a plan string using IDL discriminator and arg layout. Here we encode 3 u64 args.
    const plan = this.buildPlan("buy_exact_in", Number(amountIn)); // keep compatibility; actual args layout should come from IDL
    // Reconstruct real data payload with 3 u64 args for the caller to adjust
    const blob = Buffer.concat([
      plan.discriminator,
      this.u64(amountIn),
      this.u64(minimumOut),
      this.u64(shareFeeRate),
    ]);
    plan.data = blob;
    return plan;
  }

  // Public helper: plan a Bonk buy with exact output amount
  async planBonkBuyExactOut(
    tokenAddr: string,
    amountOut: bigint,
    maximumIn: bigint,
    shareFeeRate: bigint,
  ): Promise<BonkInstructionPlan> {
    const plan = this.buildPlan("buy_exact_out", Number(amountOut));
    const blob = Buffer.concat([
      plan.discriminator,
      this.u64(amountOut),
      this.u64(maximumIn),
      this.u64(shareFeeRate),
    ]);
    plan.data = blob;
    return plan;
  }

  // Convenience: derive a 64-bit little-endian buffer from a bigint
  private u64(v: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v.toString()), 0);
    return b;
  }

  // Exposed API: returns a TransactionInstruction for actual execution, once accounts are provided by caller
  // This mirrors PumpTrader style where the caller assembles the final Transaction with correct accounts.
  static assembleInstruction(
    plan: BonkInstructionPlan,
    accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
    payer: PublicKey,
  ) {
    const keys = accounts.map((a) => ({
      pubkey: a.pubkey,
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    }));
    return new TransactionInstruction({
      programId: plan.programId,
      keys,
      data: plan.data,
    });
  }
}

export default BonkTrader;

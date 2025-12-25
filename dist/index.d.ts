import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair } from "@solana/web3.js";
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
export declare class PumpTrader {
    private connection;
    private wallet;
    private global;
    private globalState;
    private tokenProgramCache;
    constructor(rpc: string, privateKey: string);
    /**
     * 自动检测代币使用的 token program
     */
    detectTokenProgram(tokenAddr: string): Promise<TokenProgramType>;
    /**
     * 检测代币是否在外盘 (AMM)
     */
    isAmmCompleted(tokenAddr: string): Promise<boolean>;
    /**
     * 自动判断应该使用内盘还是外盘
     */
    getTradeMode(tokenAddr: string): Promise<"bonding" | "amm">;
    loadGlobal(): Promise<GlobalState>;
    getBondingPda(mint: PublicKey): PublicKey;
    loadBonding(mint: PublicKey): Promise<BondingInfo>;
    calcBuy(solIn: bigint, state: BondingCurveState): bigint;
    calcSell(tokenIn: bigint, state: BondingCurveState): bigint;
    calculateAmmBuyOutput(quoteIn: bigint, reserves: PoolReserves): bigint;
    calculateAmmSellOutput(baseIn: bigint, reserves: PoolReserves): bigint;
    getPriceAndStatus(tokenAddr: string): Promise<{
        price: number;
        completed: boolean;
    }>;
    getAmmPrice(mint: PublicKey): Promise<number>;
    /**
     * 查询代币余额
     * @param tokenAddr - 代币地址（可选），如果不传则返回所有代币
     * @returns 如果传入地址则返回该代币的余额数字，否则返回所有代币的详细信息
     */
    tokenBalance(tokenAddr?: string): Promise<number | Array<{
        mint: string;
        amount: number;
        decimals: number;
        uiAmount: number;
    }>>;
    /**
     * 获取账户所有代币余额（仅显示余额 > 0 的）
     * @returns 代币信息数组，包含mint地址、余额等信息
     */
    getAllTokenBalances(): Promise<Array<{
        mint: string;
        amount: number;
        decimals: number;
        uiAmount: number;
    }>>;
    solBalance(): Promise<number>;
    ensureAta(tx: Transaction, mint: PublicKey, tokenProgram?: PublicKey): Promise<PublicKey>;
    ensureWSOLAta(tx: Transaction, owner: PublicKey, mode: "buy" | "sell", lamports?: bigint): Promise<PublicKey>;
    genPriority(priorityOpt: any): number;
    calcSlippage({ tradeSize, reserve, slippageOpt }: any): number;
    splitByMax(total: bigint, max: bigint): bigint[];
    splitIntoN(total: bigint, n: number): bigint[];
    /**
     * 自动判断内盘/外盘并执行买入
     */
    autoBuy(tokenAddr: string, totalSolIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    /**
     * 自动判断内盘/外盘并执行卖出
     */
    autoSell(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    buy(tokenAddr: string, totalSolIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    sell(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    ammBuy(tokenAddr: string, totalSolIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    ammSell(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    getAmmPoolInfo(mint: PublicKey): Promise<PoolInfo>;
    parseAmmGlobalConfig(data: Buffer, address: PublicKey): {
        address: PublicKey;
        admin: PublicKey;
        protocolFeeRecipients: PublicKey[];
    };
    getAmmPoolReserves(poolKeys: any): Promise<PoolReserves>;
    createAmmBuyInstruction(poolInfo: PoolInfo, userBaseAta: PublicKey, userQuoteAta: PublicKey, baseAmountOut: bigint, maxQuoteAmountIn: bigint): TransactionInstruction;
    createAmmSellInstruction(poolInfo: PoolInfo, userBaseAta: PublicKey, userQuoteAta: PublicKey, baseAmountIn: bigint, minQuoteAmountOut: bigint): TransactionInstruction;
    confirmTransactionWithPolling(signature: string, lastValidBlockHeight: number, maxAttempts?: number, delayMs?: number): Promise<string>;
    listenTrades(callback: (event: TradeEvent) => void, mintFilter?: PublicKey | null): number;
    fetchMeta(tokenAddr: string): Promise<MetadataInfo | null>;
    getWallet(): Keypair;
    getConnection(): Connection;
    /**
     * 清除token program缓存
     */
    clearTokenProgramCache(tokenAddr: string): void;
    /**
     * 获取缓存的token program信息
     */
    getCachedTokenProgram(tokenAddr: string): TokenProgramType | undefined;
}
export type { TradeOptions, PendingTransaction, FailedTransaction, TradeResult, BondingCurveState, BondingInfo, PoolReserves, TradeEvent, GlobalState, TokenProgramType, PoolInfo, MetadataInfo };

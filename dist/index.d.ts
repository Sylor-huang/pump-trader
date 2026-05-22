import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair } from "@solana/web3.js";
/** Wallet 接口：兼容 Keypair（自动签名）和前端钱包适配器（弹出确认） */
export type Wallet = Keypair | {
    publicKey: PublicKey;
    signTransaction<T extends Transaction>(tx: T): Promise<T>;
};
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
export declare class PumpTrader {
    private connection;
    private _wallet;
    publicKey: PublicKey;
    private global;
    private globalState;
    private tokenProgramCache;
    constructor(rpc: string, wallet: Wallet);
    private signTx;
    /**
     * 自动检测代币使用的 token program
     */
    detectTokenProgram(tokenAddr: string): Promise<TokenProgramType>;
    detectQuoteTokenProgram(quoteMint: PublicKey): Promise<PublicKey>;
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
    deriveBondingCurveV2(mint: PublicKey): PublicKey;
    private pickFeeRecipient;
    private pickBuybackFeeRecipient;
    private pickReservedFeeRecipient;
    getSharingConfigPda(mint: PublicKey): PublicKey;
    private buildBondingBuyKeys;
    private buildBondingSellKeys;
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
     * @param useV2 - use buy_v2 instruction (supports USDC quote) instead of legacy buy
     * @param quoteMint - quote mint for V2 (SOL_MINT for SOL-paired, or USDC mint for USDC-paired)
     */
    autoBuy(tokenAddr: string, totalSolIn: bigint, tradeOpt: TradeOptions, useV2?: boolean, quoteMint?: PublicKey): Promise<TradeResult>;
    /**
     * 自动判断内盘/外盘并执行卖出
     * @param useV2 - use sell_v2 instruction (supports USDC quote) instead of legacy sell
     * @param quoteMint - quote mint for V2 (SOL_MINT for SOL-paired, or USDC mint for USDC-paired)
     */
    autoSell(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions, useV2?: boolean, quoteMint?: PublicKey): Promise<TradeResult>;
    buy(tokenAddr: string, totalSolIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    sell(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions): Promise<TradeResult>;
    ammBuy(tokenAddr: string, totalSolIn: bigint, tradeOpt: TradeOptions, quoteMint?: PublicKey): Promise<TradeResult>;
    ammSell(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions, quoteMint?: PublicKey): Promise<TradeResult>;
    getAmmPoolInfo(mint: PublicKey, quoteMint?: PublicKey): Promise<PoolInfo>;
    parseAmmGlobalConfig(data: Buffer, address: PublicKey): {
        address: PublicKey;
        admin: PublicKey;
        protocolFeeRecipients: PublicKey[];
    };
    getAmmPoolReserves(poolKeys: any): Promise<PoolReserves>;
    deriveAmmPoolV2(baseMint: PublicKey): PublicKey;
    createAmmBuyInstruction(poolInfo: PoolInfo, userBaseAta: PublicKey, userQuoteAta: PublicKey, baseAmountOut: bigint, maxQuoteAmountIn: bigint, tokenProgramId: PublicKey): TransactionInstruction;
    createAmmSellInstruction(poolInfo: PoolInfo, userBaseAta: PublicKey, userQuoteAta: PublicKey, baseAmountIn: bigint, minQuoteAmountOut: bigint, tokenProgramId: PublicKey): TransactionInstruction;
    /**
     * Build accounts for buy_v2 instruction (27 accounts)
     * Ref: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/BUY.md
     */
    private buildBondingBuyV2Keys;
    /**
     * Build accounts for sell_v2 instruction (26 accounts)
     * Ref: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/SELL.md
     */
    private buildBondingSellV2Keys;
    /**
     * Buy using buy_v2 instruction (supports both SOL-paired and USDC-paired coins)
     * For SOL-paired coins: quoteMint = SOL_MINT, quoteTokenProgram = TOKEN_PROGRAM_ID
     * For USDC-paired coins: quoteMint = USDC mint, quoteTokenProgram = TOKEN_PROGRAM_ID
     */
    buyV2(tokenAddr: string, totalQuoteIn: bigint, tradeOpt: TradeOptions, quoteMint?: PublicKey): Promise<TradeResult>;
    /**
     * Sell using sell_v2 instruction (supports both SOL-paired and USDC-paired coins)
     */
    sellV2(tokenAddr: string, totalTokenIn: bigint, tradeOpt: TradeOptions, quoteMint?: PublicKey): Promise<TradeResult>;
    /**
     * Collect creator fees from bonding curve creator vault (collect_creator_fee_v2)
     * Ref: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md
     */
    collectCreatorFeeV2(creator: PublicKey, quoteMint?: PublicKey): Promise<string>;
    confirmTransactionWithPolling(signature: string, lastValidBlockHeight: number, maxAttempts?: number, delayMs?: number): Promise<string>;
    listenTrades(callback: (event: TradeEvent) => void, mintFilter?: PublicKey | null): number;
    fetchMeta(tokenAddr: string): Promise<MetadataInfo | null>;
    /**
     * 获取原始 wallet 对象（Keypair 或前端 WalletAdapter）
     */
    getWallet(): Wallet;
    getPublicKey(): PublicKey;
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
export type { TradeOptions, PendingTransaction, FailedTransaction, TradeResult, BondingCurveState, BondingInfo, PoolReserves, TradeEvent, GlobalState, TokenProgramType, PoolInfo, MetadataInfo, };

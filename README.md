# PumpTrader 改进版本

## 📋 核心功能

### ✨ 新增功能

1. **自动 Token Program 检测**
   - 自动识别代币使用的是 `TOKEN_PROGRAM_ID` 还是 `TOKEN_2022_PROGRAM_ID`
   - 支持缓存机制，提高性能
   - 透明处理，无需手动指定

2. **自动内盘/外盘判断**
   - 自动检测代币是否完成内盘绑定曲线
   - 智能选择是否使用 `bonding curve` 或 `AMM` 交易
   - 提供统一的 `autoBuy()` 和 `autoSell()` 接口

3. **TypeScript 支持**
   - 完整的类型定义 (index.ts)
   - 类型安全的接口
   - 更好的 IDE 自动完成

4. **JavaScript/CommonJS 兼容**
   - 改进的 JavaScript 版本 (index.js)
   - 同时支持 ESM 和 CommonJS 导入

---

## 🚀 快速开始

### 基础设置

```javascript
import { PumpTrader } from './index.js';

const RPC_URL = "https://api.mainnet-beta.solana.com";
const PRIVATE_KEY = "your_base58_private_key_here";

const trader = new PumpTrader(RPC_URL, PRIVATE_KEY);
```

### TypeScript 导入

```typescript
import { PumpTrader, TradeOptions, TradeResult } from './index';

const trader = new PumpTrader(RPC_URL, PRIVATE_KEY);
```

---

## 🎯 核心 API

### 1. Token Program 检测

#### 自动检测 Token Program

```javascript
// 自动检测代币使用的 token program
const tokenProgram = await trader.detectTokenProgram(tokenAddr);

console.log(tokenProgram.type);       // "TOKEN_PROGRAM_ID" 或 "TOKEN_2022_PROGRAM_ID"
console.log(tokenProgram.programId);  // PublicKey
```

**特点：**
- 自动缓存结果
- 失败自动回退
- 无需手动指定

### 2. 内盘/外盘检测

#### 判断交易模式

```javascript
// 返回 "bonding" 或 "amm"
const mode = await trader.getTradeMode(tokenAddr);

if (mode === "bonding") {
  console.log("代币还在内盘");
} else {
  console.log("代币已进入外盘");
}
```

#### 检查是否完成内盘

```javascript
const isCompleted = await trader.isAmmCompleted(tokenAddr);
```

### 3. 统一交易接口（推荐）

#### 自动买入

```javascript
const tradeOpt = {
  maxSolPerTx: BigInt(1_000_000_000),  // 1 SOL
  slippage: {
    base: 500,        // 5% 基础滑点
    min: 300,         // 最小 3%
    max: 1000,        // 最大 10%
    impactFactor: 1
  },
  priority: {
    base: 5000,       // microLamports
    enableRandom: true,
    randomRange: 5000
  }
};

// 自动判断内盘/外盘，自动选择合适的交易方式
const result = await trader.autoBuy(tokenAddr, BigInt(100_000_000), tradeOpt);

// 结果
console.log(result.pendingTransactions);  // 待确认的交易
console.log(result.failedTransactions);   // 失败的交易
```

#### 自动卖出

```javascript
// 自动判断内盘/外盘，自动卖出
const result = await trader.autoSell(tokenAddr, BigInt(1_000_000), tradeOpt);
```

---

## 🔧 进阶 API

### 内盘交易（手动方式）

```javascript
// 内盘买入
const buyResult = await trader.buy(tokenAddr, solAmount, tradeOpt);

// 内盘卖出
const sellResult = await trader.sell(tokenAddr, tokenAmount, tradeOpt);
```

### 外盘交易（手动方式）

```javascript
// 外盘买入
const buyResult = await trader.ammBuy(tokenAddr, solAmount, tradeOpt);

// 外盘卖出
const sellResult = await trader.ammSell(tokenAddr, tokenAmount, tradeOpt);
```

---

## 📊 查询接口

### 获取价格和状态

```javascript
const { price, completed } = await trader.getPriceAndStatus(tokenAddr);

console.log(price);      // 当前价格 (SOL)
console.log(completed);  // 是否完成内盘
```

### 查询余额

```javascript
// 代币余额
const tokenBalance = await trader.tokenBalance(tokenAddr);

// SOL 余额
const solBalance = await trader.solBalance();
```

### 获取元数据

```javascript
const metadata = await trader.fetchMeta(tokenAddr);

console.log(metadata?.name);
console.log(metadata?.symbol);
console.log(metadata?.uri);
```

---

## 📡 事件监听

### 监听交易事件

```javascript
import { PublicKey } from '@solana/web3.js';

const tokenMint = new PublicKey(tokenAddr);

const unsubscribe = trader.listenTrades(
  (event) => {
    console.log("交易类型:", event.isBuy ? "买入" : "卖出");
    console.log("SOL 数量:", Number(event.solAmount) / 1e9);
    console.log("代币数量:", Number(event.tokenAmount) / 1e6);
    console.log("用户:", event.user);
    console.log("时间戳:", event.timestamp);
    console.log("交易哈希:", event.signature);
  },
  tokenMint  // 可选，指定监听特定代币
);

// 停止监听
unsubscribe();
```

---

## ✅ 交易确认

### 轮询确认交易

```javascript
const result = await trader.confirmTransactionWithPolling(
  signature,              // 交易哈希
  lastValidBlockHeight,   // 最后有效块高
  5,                      // 最大尝试次数
  2000                    // 延迟 (毫秒)
);

console.log("交易已确认:", result);
```

---

## 💾 缓存管理

### Token Program 缓存

```javascript
// 获取缓存的 token program 信息
const cached = trader.getCachedTokenProgram(tokenAddr);

// 清除特定 Token 的缓存
trader.clearTokenProgramCache(tokenAddr);

// 清除所有缓存
trader.clearTokenProgramCache();
```

---

## 👛 钱包信息

### 获取钱包和连接

```javascript
const wallet = trader.getWallet();
const connection = trader.getConnection();

console.log("公钥:", wallet.publicKey.toBase58());
console.log("RPC 端点:", connection.rpcEndpoint);
```

---

## 📝 TypeScript 类型

### TradeOptions

```typescript
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
```

### TradeResult

```typescript
interface TradeResult {
  pendingTransactions: PendingTransaction[];
  failedTransactions: FailedTransaction[];
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
```

### TokenProgramType

```typescript
interface TokenProgramType {
  type: "TOKEN_PROGRAM_ID" | "TOKEN_2022_PROGRAM_ID";
  programId: PublicKey;
}
```

---

## 🔍 使用示例

### 示例 1: 自动交易（推荐）

```javascript
async function autoTrade() {
  const trader = new PumpTrader(RPC, PRIVATE_KEY);
  
  const tradeOpt = {
    maxSolPerTx: BigInt(1_000_000_000),
    slippage: { base: 500 },
    priority: { base: 5000 }
  };

  // 自动判断内盘/外盘，自动买入
  const result = await trader.autoBuy(tokenAddr, BigInt(100_000_000), tradeOpt);
  
  // 确认第一笔交易
  if (result.pendingTransactions.length > 0) {
    const tx = result.pendingTransactions[0];
    await trader.confirmTransactionWithPolling(tx.signature, tx.lastValidBlockHeight);
  }
}
```

### 示例 2: 批量操作

```javascript
async function batchTrade() {
  const trader = new PumpTrader(RPC, PRIVATE_KEY);
  const tokens = ["addr1", "addr2", "addr3"];

  for (const tokenAddr of tokens) {
    try {
      // 检测内盘/外盘
      const mode = await trader.getTradeMode(tokenAddr);
      console.log(`${tokenAddr}: ${mode}`);
      
      // 自动买入
      const result = await trader.autoBuy(tokenAddr, BigInt(10_000_000), tradeOpt);
      console.log(`发送了 ${result.pendingTransactions.length} 笔交易`);
    } catch (error) {
      console.error(`${tokenAddr}: ${error.message}`);
    }
  }
}
```

### 示例 3: 监听和交易

```javascript
async function listenAndTrade() {
  const trader = new PumpTrader(RPC, PRIVATE_KEY);
  const tokenMint = new PublicKey(tokenAddr);

  // 监听交易
  const unsubscribe = trader.listenTrades((event) => {
    if (event.isBuy) {
      console.log(`新买单: ${Number(event.solAmount) / 1e9} SOL`);
      // 可以根据交易事件触发自动交易
    }
  }, tokenMint);

  // 监听 60 秒
  setTimeout(() => unsubscribe(), 60000);
}
```

---

## 🛠️ 文件结构

```
pump_trader/
├── index.js              # 改进的 JavaScript 实现
├── index.ts              # TypeScript 类型定义和实现
├── examples.js           # JavaScript 使用示例
├── examples.ts           # TypeScript 使用示例
├── README.md             # 本文档
└── package.json          # 项目配置
```

---

## 📦 依赖项

```json
{
  "@solana/web3.js": "^1.78.0",
  "@solana/spl-token": "^0.3.10",
  "bn.js": "^5.2.1",
  "bs58": "^5.0.0"
}
```

---

## ⚡ 性能优化

### Token Program 缓存

```javascript
// 首次调用：会调用 getMint()
const prog1 = await trader.detectTokenProgram(tokenAddr);  // 较慢

// 后续调用：使用缓存
const prog2 = await trader.detectTokenProgram(tokenAddr);  // 很快
```

### 批量操作建议

```javascript
// ✅ 推荐：使用 autoBuy/autoSell
const result = await trader.autoBuy(tokenAddr, amount, tradeOpt);

// ❌ 不推荐：多次调用 buy/ammBuy
// 代码更复杂，需要手动判断内盘/外盘
```

---

## 🔐 安全建议

1. **私钥管理**
   - 使用环境变量存储私钥
   - 不要在代码中硬编码私钥
   - 使用专用的钱包管理库

2. **RPC 端点**
   - 考虑使用专用 RPC 服务
   - 不要公开 RPC 端点
   - 对 RPC 请求设置速率限制

3. **交易参数**
   - 测试网上先验证逻辑
   - 正确设置滑点和优先级费用
   - 监控交易状态

---

## 🐛 常见问题

### Q: Token Program 检测失败怎么办？

```javascript
try {
  const prog = await trader.detectTokenProgram(tokenAddr);
} catch (error) {
  console.error("检测失败，可能是无效的代币地址");
  // 1. 检查代币地址是否正确
  // 2. 检查 RPC 连接
  // 3. 重试
}
```

### Q: 如何禁用缓存？

```javascript
// 每次都重新检测
const prog = await trader.detectTokenProgram(tokenAddr);
trader.clearTokenProgramCache(tokenAddr);  // 立即清除缓存
```

### Q: 如何选择内盘还是外盘？

```javascript
// 使用 autoBuy/autoSell 让库自动选择
const result = await trader.autoBuy(tokenAddr, amount, tradeOpt);

// 或者手动检查
const mode = await trader.getTradeMode(tokenAddr);
if (mode === "bonding") {
  // 手动调用内盘方法
} else {
  // 手动调用外盘方法
}
```

---

## 📞 技术支持

有问题或建议？查看代码中的详细注释或查看 examples.js/examples.ts 文件中的实际使用示例。

---

## 📄 许可证

参照原项目许可证。

---

**最后更新**: 2025年12月25日
**版本**: 2.0 (改进版本)

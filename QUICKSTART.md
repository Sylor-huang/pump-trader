# 快速开始指南

## 🎯 5 分钟快速上手

### 步骤 1: 安装依赖

```bash
npm install @solana/web3.js @solana/spl-token bn.js bs58
```

### 步骤 2: 导入库

#### JavaScript

```javascript
import { PumpTrader } from './index.js';

const RPC = "https://api.mainnet-beta.solana.com";
const PRIVATE_KEY = "your_private_key";

const trader = new PumpTrader(RPC, PRIVATE_KEY);
```

#### TypeScript

```typescript
import { PumpTrader, TradeOptions } from './index';

const trader = new PumpTrader(RPC, PRIVATE_KEY);
```

### 步骤 3: 自动交易

```javascript
// 定义交易参数
const tradeOpt = {
  maxSolPerTx: BigInt(1_000_000_000),  // 1 SOL
  slippage: { base: 500 },             // 5% 滑点
  priority: { base: 5000 }             // 优先级
};

// 自动买入（库自动判断内盘/外盘）
const result = await trader.autoBuy(
  "token_address", 
  BigInt(100_000_000),  // 0.1 SOL
  tradeOpt
);

console.log("交易已发送:", result.pendingTransactions);
```

---

## 🚀 核心概念（3 分钟）

### 问题 1: 什么是 Token Program？

**简答：** 控制 Token 的程序版本

- **TOKEN_PROGRAM_ID**: 标准 Token (SPL)
- **TOKEN_2022_PROGRAM_ID**: 新版本 Token (SPL-2022)

**库的处理：**
```javascript
// ✅ 自动检测，无需手动指定
const tokenProgram = await trader.detectTokenProgram(tokenAddr);
console.log(tokenProgram.type);  // 自动识别是哪个版本
```

### 问题 2: 什么是内盘/外盘？

**简答：** Token 的两个交易阶段

- **内盘 (Bonding Curve)**: 启动阶段，价格由绑定曲线决定
- **外盘 (AMM)**: 成熟阶段，进入 Raydium 等 AMM

**库的处理：**
```javascript
// ✅ 自动判断，无需手动判断
const mode = await trader.getTradeMode(tokenAddr);
// 返回 "bonding" 或 "amm"

// ✅ 统一接口，自动选择
const result = await trader.autoBuy(tokenAddr, amount, tradeOpt);
// 无论是内盘还是外盘，都能正确交易
```

### 问题 3: 为什么需要这个库？

```javascript
// ❌ 手动方式（繁琐）
if (mode === "bonding") {
  result = await trader.buy(tokenAddr, amount, tradeOpt);
} else {
  result = await trader.ammBuy(tokenAddr, amount, tradeOpt);
}

// ✅ 改进方式（简洁）
result = await trader.autoBuy(tokenAddr, amount, tradeOpt);
```

---

## 📚 常用代码片段

### 买入（自动判断）

```javascript
const result = await trader.autoBuy(
  "TokenAddress", 
  BigInt(100_000_000),
  { maxSolPerTx: BigInt(1e9), slippage: { base: 500 }, priority: { base: 5000 } }
);
```

### 卖出（自动判断）

```javascript
const result = await trader.autoSell(
  "TokenAddress", 
  BigInt(1_000_000),  // 要卖出的代币数量
  { maxSolPerTx: BigInt(1e9), slippage: { base: 500 }, priority: { base: 5000 } }
);
```

### 查看价格

```javascript
const { price, completed } = await trader.getPriceAndStatus("TokenAddress");
console.log(`价格: ${price} SOL`);
console.log(`状态: ${completed ? "外盘" : "内盘"}`);
```

### 查看余额

```javascript
const balance = await trader.tokenBalance("TokenAddress");
console.log(`代币余额: ${balance}`);

const solBalance = await trader.solBalance();
console.log(`SOL 余额: ${solBalance}`);
```

### 监听交易

```javascript
const unsubscribe = trader.listenTrades((event) => {
  console.log(`${event.isBuy ? "买" : "卖"}: ${Number(event.solAmount) / 1e9} SOL`);
});

// 停止监听
setTimeout(() => unsubscribe(), 60000);
```

---

## 🎨 完整示例

### 示例：自动买入 + 确认 + 卖出

```javascript
import { PumpTrader } from './index.js';

async function quickTrade() {
  const trader = new PumpTrader(
    "https://api.mainnet-beta.solana.com",
    "your_private_key"
  );

  const tokenAddr = "token_address_here";
  const tradeOpt = {
    maxSolPerTx: BigInt(1_000_000_000),
    slippage: { base: 500 },
    priority: { base: 5000, enableRandom: true, randomRange: 5000 }
  };

  try {
    // 1️⃣ 买入
    console.log("🛒 开始买入...");
    const buyResult = await trader.autoBuy(
      tokenAddr,
      BigInt(100_000_000),  // 0.1 SOL
      tradeOpt
    );

    if (buyResult.pendingTransactions.length > 0) {
      const tx = buyResult.pendingTransactions[0];
      console.log(`✅ 买入交易: ${tx.signature}`);

      // 2️⃣ 确认
      console.log("⏳ 等待确认...");
      await trader.confirmTransactionWithPolling(
        tx.signature,
        tx.lastValidBlockHeight,
        5,
        2000
      );
      console.log("✅ 交易已确认");
    }

    // 3️⃣ 查看余额
    const balance = await trader.tokenBalance(tokenAddr);
    console.log(`💰 你现在拥有 ${balance} 个 Token`);

    // 4️⃣ 卖出
    console.log("📤 开始卖出...");
    const sellResult = await trader.autoSell(
      tokenAddr,
      BigInt(Math.floor(balance * 1e6)),
      tradeOpt
    );

    if (sellResult.pendingTransactions.length > 0) {
      console.log(`✅ 卖出交易: ${sellResult.pendingTransactions[0].signature}`);
    }

  } catch (error) {
    console.error("❌ 错误:", error.message);
  }
}

quickTrade();
```

---

## 🔧 参数配置说明

### TradeOptions 详解

```javascript
{
  // 每笔交易的最大 SOL 数量
  maxSolPerTx: BigInt(1_000_000_000),  // 1 SOL
  
  // 滑点设置
  slippage: {
    base: 500,          // 基础滑点 5% (bps)
    min: 300,           // 最小 3%
    max: 1000,          // 最大 10%
    impactFactor: 1     // 价格影响系数 (1 = 标准)
  },
  
  // 优先级费用
  priority: {
    base: 5000,         // 基础费用 (microLamports)
    enableRandom: true, // 启用随机
    randomRange: 5000   // 随机范围 (0-5000)
  }
}
```

**常见配置：**

```javascript
// 保守配置（低风险）
{
  maxSolPerTx: BigInt(1e9),
  slippage: { base: 1000, min: 500, max: 2000 },
  priority: { base: 10000 }
}

// 激进配置（高速度）
{
  maxSolPerTx: BigInt(5e9),
  slippage: { base: 300, min: 100, max: 500 },
  priority: { base: 50000, enableRandom: true, randomRange: 50000 }
}

// 平衡配置（推荐）
{
  maxSolPerTx: BigInt(1e9),
  slippage: { base: 500, min: 300, max: 1000 },
  priority: { base: 5000, enableRandom: true, randomRange: 5000 }
}
```

---

## ❌ 常见错误 & 解决方案

### 错误 1: "Token Program 检测失败"

```
错误: Failed to detect token program for XXX
```

**原因：** Token 地址无效或 RPC 连接问题

**解决：**
```javascript
// 检查地址是否正确
console.log("Token 地址:", tokenAddr);

// 检查 RPC 连接
const connection = trader.getConnection();
const balance = await connection.getBalance(trader.getWallet().publicKey);
console.log("钱包余额:", balance);
```

### 错误 2: "Bonding curve already completed"

```
错误: Bonding curve already completed
```

**原因：** Token 已进入外盘，不能再用 buy() 方法

**解决：**
```javascript
// 使用自动方法，会自动选择
const result = await trader.autoBuy(tokenAddr, amount, tradeOpt);
// 不用手动判断
```

### 错误 3: "交易超时"

```
错误: 交易确认超时
```

**原因：** 网络拥堵，交易没有及时确认

**解决：**
```javascript
// 增加优先级费用
const tradeOpt = {
  priority: { base: 50000 }  // 增加到 50000 microLamports
};

// 或者增加重试次数
await trader.confirmTransactionWithPolling(
  signature,
  blockHeight,
  10,    // 增加重试次数
  2000
);
```

---

## 📊 性能优化建议

### 1. 使用缓存

```javascript
// 第一次：自动缓存
const prog1 = await trader.detectTokenProgram(tokenAddr);

// 第二次：使用缓存（更快）
const prog2 = await trader.detectTokenProgram(tokenAddr);

// 查看缓存
console.log(trader.getCachedTokenProgram(tokenAddr));

// 清除缓存（如果需要）
trader.clearTokenProgramCache(tokenAddr);
```

### 2. 批量操作

```javascript
// 好的做法：顺序处理，允许失败继续
for (const tokenAddr of tokens) {
  try {
    const result = await trader.autoBuy(tokenAddr, amount, tradeOpt);
  } catch (error) {
    console.error(`${tokenAddr} 失败: ${error.message}`);
    // 继续下一个
  }
}
```

### 3. 监听事件而不是轮询

```javascript
// ❌ 不推荐：不断轮询余额
setInterval(async () => {
  const balance = await trader.tokenBalance(tokenAddr);
  // 效率低，浪费 API 配额
}, 1000);

// ✅ 推荐：监听事件
trader.listenTrades((event) => {
  if (event.isBuy && event.solAmount > BigInt(1e9)) {
    // 大额买入
    console.log("检测到大额买入");
  }
});
```

---

## 📝 下一步

- 查看 [README.md](./README.md) 了解完整 API
- 查看 [examples.js](./examples.js) 看更多示例
- 查看 [IMPROVEMENTS.md](./IMPROVEMENTS.md) 了解改进细节

---

**祝你交易愉快！** 🚀

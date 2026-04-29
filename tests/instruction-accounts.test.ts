import test from "node:test";
import assert from "node:assert/strict";

import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { PumpTrader } from "../index";

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const FEE_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW"
].map((value) => new PublicKey(value));

function createTrader() {
  return new PumpTrader("http://127.0.0.1:8899", bs58.encode(Keypair.generate().secretKey));
}

function createPoolInfo(isCashbackCoin: boolean) {
  return {
    pool: Keypair.generate().publicKey,
    poolAuthority: Keypair.generate().publicKey,
    poolKeys: {
      baseMint: Keypair.generate().publicKey,
      quoteMint: SOL_MINT,
      poolBaseTokenAccount: Keypair.generate().publicKey,
      poolQuoteTokenAccount: Keypair.generate().publicKey,
      coinCreator: Keypair.generate().publicKey,
      isCashbackCoin
    },
    globalConfig: {
      address: Keypair.generate().publicKey,
      protocolFeeRecipients: FEE_RECIPIENTS
    }
  };
}

test("bonding buy appends mutable fee recipient after bondingCurveV2", () => {
  const trader = createTrader() as any;
  const bondingCurveV2 = Keypair.generate().publicKey;
  const feeRecipient = FEE_RECIPIENTS[0];

  const keys = trader.buildBondingBuyKeys({
    global: Keypair.generate().publicKey,
    globalFeeRecipient: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    bonding: Keypair.generate().publicKey,
    associatedBondingCurve: Keypair.generate().publicKey,
    userAta: Keypair.generate().publicKey,
    wallet: Keypair.generate().publicKey,
    creatorVault: Keypair.generate().publicKey,
    eventAuthority: Keypair.generate().publicKey,
    pumpProgram: Keypair.generate().publicKey,
    globalVolumeAccumulator: Keypair.generate().publicKey,
    userVolumeAccumulator: Keypair.generate().publicKey,
    feeConfig: Keypair.generate().publicKey,
    feeProgram: Keypair.generate().publicKey,
    bondingCurveV2,
    feeRecipient
  });

  assert.equal(keys.length, 18);
  assert.equal(keys.at(-2).pubkey.toBase58(), bondingCurveV2.toBase58());
  assert.equal(keys.at(-2).isWritable, false);
  assert.equal(keys.at(-1).pubkey.toBase58(), feeRecipient.toBase58());
  assert.equal(keys.at(-1).isWritable, true);
});

test("bonding sell appends mutable fee recipient after optional cashback and bondingCurveV2", () => {
  const trader = createTrader() as any;
  const baseArgs = {
    global: Keypair.generate().publicKey,
    globalFeeRecipient: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    bonding: Keypair.generate().publicKey,
    associatedBondingCurve: Keypair.generate().publicKey,
    userAta: Keypair.generate().publicKey,
    wallet: Keypair.generate().publicKey,
    creatorVault: Keypair.generate().publicKey,
    eventAuthority: Keypair.generate().publicKey,
    pumpProgram: Keypair.generate().publicKey,
    feeConfig: Keypair.generate().publicKey,
    feeProgram: Keypair.generate().publicKey,
    bondingCurveV2: Keypair.generate().publicKey,
    feeRecipient: FEE_RECIPIENTS[0],
    userVolumeAccumulator: Keypair.generate().publicKey
  };

  const nonCashback = trader.buildBondingSellKeys({
    ...baseArgs,
    isCashbackCoin: false
  });
  assert.equal(nonCashback.length, 16);
  assert.equal(nonCashback.at(-2).pubkey.toBase58(), baseArgs.bondingCurveV2.toBase58());
  assert.equal(nonCashback.at(-1).pubkey.toBase58(), baseArgs.feeRecipient.toBase58());
  assert.equal(nonCashback.at(-1).isWritable, true);

  const cashback = trader.buildBondingSellKeys({
    ...baseArgs,
    isCashbackCoin: true
  });
  assert.equal(cashback.length, 17);
  assert.equal(cashback.at(-3).pubkey.toBase58(), baseArgs.userVolumeAccumulator.toBase58());
  assert.equal(cashback.at(-2).pubkey.toBase58(), baseArgs.bondingCurveV2.toBase58());
  assert.equal(cashback.at(-1).pubkey.toBase58(), baseArgs.feeRecipient.toBase58());
});

test("amm buy places poolV2 before fee recipient pair for non-cashback coins", () => {
  const trader = createTrader();
  const poolInfo = createPoolInfo(false);
  const userBaseAta = Keypair.generate().publicKey;
  const userQuoteAta = Keypair.generate().publicKey;

  const instruction = trader.createAmmBuyInstruction(
    poolInfo as any,
    userBaseAta,
    userQuoteAta,
    1n,
    2n,
    TOKEN_PROGRAM_ID
  );

  const feeRecipient = poolInfo.globalConfig.protocolFeeRecipients[0];
  const feeRecipientAta = getAssociatedTokenAddressSync(
    SOL_MINT,
    feeRecipient,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  assert.equal(instruction.keys.length, 26);
  assert.equal(instruction.keys.at(-3)?.pubkey.toBase58(), trader.deriveAmmPoolV2(poolInfo.poolKeys.baseMint).toBase58());
  assert.equal(instruction.keys.at(-2)?.pubkey.toBase58(), feeRecipient.toBase58());
  assert.equal(instruction.keys.at(-2)?.isWritable, false);
  assert.equal(instruction.keys.at(-1)?.pubkey.toBase58(), feeRecipientAta.toBase58());
  assert.equal(instruction.keys.at(-1)?.isWritable, true);
});

test("amm buy places cashback account before poolV2 and fee recipient tail", () => {
  const trader = createTrader();
  const poolInfo = createPoolInfo(true);

  const instruction = trader.createAmmBuyInstruction(
    poolInfo as any,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    1n,
    2n,
    TOKEN_PROGRAM_ID
  );

  assert.equal(instruction.keys.length, 27);
  assert.equal(instruction.keys.at(-3)?.isWritable, false);
  assert.equal(instruction.keys.at(-2)?.pubkey.toBase58(), poolInfo.globalConfig.protocolFeeRecipients[0].toBase58());
  assert.equal(instruction.keys.at(-1)?.isWritable, true);
});

test("amm sell places poolV2 before fee recipient pair for non-cashback coins", () => {
  const trader = createTrader();
  const poolInfo = createPoolInfo(false);

  const instruction = trader.createAmmSellInstruction(
    poolInfo as any,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    1n,
    2n,
    TOKEN_PROGRAM_ID
  );

  assert.equal(instruction.keys.length, 24);
  assert.equal(instruction.keys.at(-3)?.pubkey.toBase58(), trader.deriveAmmPoolV2(poolInfo.poolKeys.baseMint).toBase58());
  assert.equal(instruction.keys.at(-2)?.pubkey.toBase58(), poolInfo.globalConfig.protocolFeeRecipients[0].toBase58());
  assert.equal(instruction.keys.at(-1)?.isWritable, true);
});

test("amm sell places cashback accounts before poolV2 and fee recipient tail", () => {
  const trader = createTrader();
  const poolInfo = createPoolInfo(true);

  const instruction = trader.createAmmSellInstruction(
    poolInfo as any,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    1n,
    2n,
    TOKEN_PROGRAM_ID
  );

  assert.equal(instruction.keys.length, 26);
  assert.equal(instruction.keys.at(-3)?.pubkey.toBase58(), trader.deriveAmmPoolV2(poolInfo.poolKeys.baseMint).toBase58());
  assert.equal(instruction.keys.at(-2)?.pubkey.toBase58(), poolInfo.globalConfig.protocolFeeRecipients[0].toBase58());
  assert.equal(instruction.keys.at(-1)?.pubkey.toBase58(), getAssociatedTokenAddressSync(
    SOL_MINT,
    poolInfo.globalConfig.protocolFeeRecipients[0],
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  ).toBase58());
  assert.equal(instruction.keys.at(-1)?.isWritable, true);
});

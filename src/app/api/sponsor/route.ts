import { http, createClient, type Client, type Transport, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { tempo } from "tempo.ts/chains";
import { config } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import * as Hex from "ox/Hex";
import * as Secp256k1 from "ox/Secp256k1";
import { TransactionEnvelopeAA } from "tempo.ts/ox";

// Lazy initialization to avoid build-time errors
let account: PrivateKeyAccount | null = null;
let client: Client<Transport, Chain> | null = null;

function getAccount(): PrivateKeyAccount {
  if (!account) {
    if (!config.backendPrivateKey) {
      throw new Error("BACKEND_PRIVATE_KEY not configured");
    }
    account = privateKeyToAccount(config.backendPrivateKey);
    console.log("[SPONSOR] Fee payer account:", account.address);
  }
  return account;
}

function getClient(): Client<Transport, Chain> {
  if (!client) {
    if (!config.alphaUsdAddress) {
      throw new Error("ALPHA_USD_ADDRESS not configured");
    }
    const chain = tempo({ feeToken: config.alphaUsdAddress });
    client = createClient({
      chain,
      transport: http(config.tempoRpcBaseUrl, {
        fetchOptions: config.tempoRpcAuth ? {
          headers: {
            Authorization: `Basic ${config.tempoRpcAuth}`,
          },
        } : undefined,
      }),
    });
  }
  return client;
}

/**
 * Manual fee payer signing implementation.
 * 
 * This is required because Handler.feePayer from tempo.ts/server has a bug:
 * it uses viem's signTransaction which overwrites the sender's WebAuthn signature
 * instead of adding a separate fee payer signature.
 * 
 * Per the AA Transaction Spec, fee payer signatures use magic byte 0x78 and
 * must be secp256k1 only.
 */
async function signAsFeePayer(
  serializedTx: `0x${string}`,
  senderAddress: `0x${string}`
): Promise<`0x${string}`> {
  // Strip the sender address (20 bytes = 40 hex chars) and marker (6 bytes = 12 hex chars)
  // Format: 0x76... + senderAddress (20 bytes) + feefeefeefee (6 bytes)
  const rawTx = serializedTx.slice(0, -52) as `0x76${string}`;
  console.log("[SPONSOR] Raw tx for deserialization length:", rawTx.length);
  
  // Deserialize the AA transaction envelope
  const envelope = TransactionEnvelopeAA.deserialize(rawTx);
  console.log("[SPONSOR] Deserialized envelope:", JSON.stringify({
    chainId: envelope.chainId,
    nonce: envelope.nonce?.toString(),
    gas: envelope.gas?.toString(),
    maxFeePerGas: envelope.maxFeePerGas?.toString(),
    feeToken: envelope.feeToken,
    hasSignature: !!envelope.signature,
    signatureType: envelope.signature?.type,
    feePayerSignature: envelope.feePayerSignature,
    callsCount: envelope.calls?.length,
  }, null, 2));
  
  // Log more signature details for debugging
  if (envelope.signature) {
    console.log("[SPONSOR] Sender signature type:", envelope.signature.type);
    if (envelope.signature.type === "webAuthn") {
      console.log("[SPONSOR] WebAuthn signature present - this is expected for passkey accounts");
    }
  }
  
  // IMPORTANT: Per AA Transaction Spec, when fee_payer_signature is present,
  // the sender should have signed with fee_token as EMPTY (0x80).
  // However, tempo.ts includes fee_token in the sender's signature domain.
  // 
  // The protocol may validate sender signature expecting fee_token = 0x80,
  // but tempo.ts made the sender sign with fee_token = actual address.
  // This could cause "invalid transaction signature" errors.
  console.log("[SPONSOR] NOTE: Sender signed with feeToken =", envelope.feeToken);
  console.log("[SPONSOR] Per spec, sender should have signed with feeToken = 0x80 (empty)");
  
  if (!envelope.signature) {
    throw new Error("Transaction has no sender signature");
  }
  
  // Ensure fee token is set
  const envelopeWithFeeToken = {
    ...envelope,
    feeToken: envelope.feeToken || config.alphaUsdAddress,
  };
  
  // Get the fee payer signing payload (uses magic byte 0x78)
  const feePayerPayload = TransactionEnvelopeAA.getFeePayerSignPayload(envelopeWithFeeToken, {
    sender: senderAddress,
  });
  console.log("[SPONSOR] Fee payer payload:", feePayerPayload);
  console.log("[SPONSOR] Sender address for payload:", senderAddress);
  
  // Sign with the backend private key (secp256k1)
  const feePayerSignature = Secp256k1.sign({
    payload: feePayerPayload,
    privateKey: config.backendPrivateKey!,
  });
  console.log("[SPONSOR] Fee payer signature r:", feePayerSignature.r.toString(16).slice(0, 16) + "...");
  console.log("[SPONSOR] Fee payer signature s:", feePayerSignature.s.toString(16).slice(0, 16) + "...");
  console.log("[SPONSOR] Fee payer signature yParity:", feePayerSignature.yParity);
  
  // Verify the signature recovers to our expected address
  const recoveredAddress = Secp256k1.recoverAddress({
    payload: feePayerPayload,
    signature: feePayerSignature,
  });
  console.log("[SPONSOR] Fee payer recovered address:", recoveredAddress);
  console.log("[SPONSOR] Expected fee payer address:", getAccount().address);
  console.log("[SPONSOR] Addresses match:", recoveredAddress.toLowerCase() === getAccount().address.toLowerCase());
  
  // Create new envelope with BOTH the original sender signature AND fee payer signature
  // The `from` function spreads envelope_ first, then adds signature/feePayerSignature from options
  // Since envelopeWithFeeToken already has .signature, it will be preserved
  const signedEnvelope = TransactionEnvelopeAA.from(envelopeWithFeeToken, {
    feePayerSignature,
  });
  
  console.log("[SPONSOR] Signed envelope has sender signature:", !!signedEnvelope.signature);
  console.log("[SPONSOR] Signed envelope sender signature type:", signedEnvelope.signature?.type);
  console.log("[SPONSOR] Signed envelope has fee payer signature:", !!signedEnvelope.feePayerSignature);
  
  // Serialize the final transaction
  const signedTx = TransactionEnvelopeAA.serialize(signedEnvelope);
  console.log("[SPONSOR] Final signed tx length:", signedTx.length);
  console.log("[SPONSOR] Final signed tx prefix:", signedTx.slice(0, 20));
  
  return signedTx;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    console.log("[SPONSOR] ========== INCOMING REQUEST ==========");
    console.log("[SPONSOR] RPC method:", body.method);
    
    if (body.method === "eth_sendRawTransaction" || body.method === "eth_sendRawTransactionSync") {
      const serialized = body.params?.[0] as `0x${string}`;
      console.log("[SPONSOR] Raw tx length:", serialized.length);
      console.log("[SPONSOR] Raw tx type:", Hex.slice(serialized, 0, 1));
      
      // Check for the feefeefeefee marker that indicates fee sponsorship is requested
      const hasMarker = Hex.slice(serialized, -6) === "0xfeefeefeefee";
      console.log("[SPONSOR] Has feefeefeefee marker:", hasMarker);
      
      if (!hasMarker) {
        // No marker - just forward to RPC (regular transaction)
        console.log("[SPONSOR] No marker - forwarding to RPC...");
        const result = await getClient().request({
          method: body.method as "eth_sendRawTransactionSync",
          params: [serialized],
        });
        return NextResponse.json({ jsonrpc: "2.0", id: body.id, result });
      }
      
      // Extract sender address from the marker suffix
      // Format: ...txData + senderAddress (20 bytes) + feefeefeefee (6 bytes)
      const senderAddress = Hex.slice(serialized, -26, -6) as `0x${string}`;
      console.log("[SPONSOR] Sender address:", senderAddress);
      
      try {
        // Sign the transaction as fee payer
        const signedTx = await signAsFeePayer(serialized, senderAddress);
        
        // Broadcast the fully signed transaction
        console.log("[SPONSOR] Broadcasting to RPC...");
        const result = await getClient().request({
          method: body.method as "eth_sendRawTransactionSync",
          params: [signedTx],
        });
        console.log("[SPONSOR] Broadcast result:", result);
        
        return NextResponse.json({ jsonrpc: "2.0", id: body.id, result });
      } catch (signError) {
        console.error("[SPONSOR] Signing/broadcast error:", signError);
        throw signError;
      }
    }
    
    // Unsupported method
    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: `Method not supported: ${body.method}` }
    }, { status: 400 });
  } catch (error) {
    console.error("[SPONSOR] Error:", error);
    return NextResponse.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" }
    }, { status: 500 });
  }
}

import { createClient, http } from "viem";
import { tempo } from "tempo.ts/chains";

const client = createClient({
  chain: tempo({ feeToken: "0x20c0000000000000000000000000000000000001" }),
  transport: http("https://rpc.testnet.tempo.xyz", {
    fetchOptions: {
        headers: {
            Authorization: `Basic ${Buffer.from("dreamy-northcutt:recursing-payne").toString("base64")}`,
        },
    },
  }),
});

async function fund() {
  const address = "0x997AD2224989cCDBBCA40ddEe07D05cca86fF193";
  console.log(`Funding ${address}...`);
  
  try {
    const hash = await client.request({
      method: "tempo_fundAddress",
      params: [address, "0x20c0000000000000000000000000000000000001"], // AlphaUSD
    });
    console.log("Funding tx:", hash);
  } catch (e) {
    console.error("Funding failed:", e);
  }
}

fund();

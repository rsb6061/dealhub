import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const TAG = process.env.AMAZON_PARTNER_TAG;      // giftjet0a-20
const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
const SECRET_KEY = process.env.AMAZON_SECRET_KEY;

const HOST = "webservices.amazon.com";
const REGION = "us-east-1";
const SERVICE = "ProductAdvertisingAPI";
const TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems";
const ENDPOINT = `https://${HOST}/paapi5/searchitems`;

app.get("/health", (_req, res) => res.json({ ok: true }));

function amzDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return {
    amzdate: `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`,
    datestamp: `${yyyy}${mm}${dd}`
  };
}

function hmac(key, msg) {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest();
}
function sha256Hex(msg) {
  return crypto.createHash("sha256").update(msg, "utf8").digest("hex");
}

async function signedFetch(bodyObj) {
  if (!TAG || !ACCESS_KEY || !SECRET_KEY) {
    throw new Error("Missing AMAZON_PARTNER_TAG / AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY");
  }

  const body = JSON.stringify(bodyObj);
  const { amzdate, datestamp } = amzDate();

  const canonicalUri = "/paapi5/searchitems";
  const canonicalQuery = "";
  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=utf-8\n` +
    `host:${HOST}\n` +
    `x-amz-date:${amzdate}\n` +
    `x-amz-target:${TARGET}\n`;
  const signedHeaders = "content-encoding;content-type;host;x-amz-date;x-amz-target";
  const payloadHash = sha256Hex(body);

  const canonicalRequest =
    `POST\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${datestamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign =
    `${algorithm}\n${amzdate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac("AWS4" + SECRET_KEY, datestamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `${algorithm} Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-encoding": "amz-1.0",
      "content-type": "application/json; charset=utf-8",
      host: HOST,
      "x-amz-date": amzdate,
      "x-amz-target": TARGET,
      Authorization: authorization
    },
    body
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`PA-API HTTP ${resp.status}: ${text}`);
  return JSON.parse(text);
}

function inferCategory(title = "") {
  const t = title.toLowerCase();
  if (t.includes("faucet")) return "faucet";
  if (t.includes("valve") || t.includes("shower")) return "shower_valve";
  if (t.includes("bidet")) return "bidet_seat";
  if (t.includes("chandelier")) return "chandelier";
  if (t.includes("pendant")) return "pendant_light";
  if (t.includes("light")) return "ceiling_light";
  return "accessory";
}

app.get("/deals", async (req, res) => {
  try {
    const brand = String(req.query.brand || "").trim();
    if (!brand) return res.status(400).json({ error: "brand required" });

    const payload = {
      PartnerTag: TAG,
      PartnerType: "Associates",
      Marketplace: "www.amazon.com",
      Keywords: `${brand} faucet shower valve bidet lighting`,
      ItemCount: 10,
      Resources: [
        "Images.Primary.Medium",
        "ItemInfo.Title",
        "ItemInfo.ManufactureInfo",
        "Offers.Listings.Price"
      ]
    };

    const data = await signedFetch(payload);
    const items = data?.SearchResult?.Items || [];

    const deals = items
      .map((it) => {
        const asin = it?.ASIN;
        const title = it?.ItemInfo?.Title?.DisplayValue || "";
        const img = it?.Images?.Primary?.Medium?.URL || "";
        const listing = it?.Offers?.Listings?.[0];
        const price = listing?.Price?.Amount;
        const basis = listing?.Price?.SavingsBasis?.Amount;

        if (!asin || !price || !basis || basis <= price) return null;

        const percent_off = (basis - price) / basis;
        if (percent_off < 0.25) return null;

        return {
          brand,
          product_name: title,
          model_number: it?.ItemInfo?.ManufactureInfo?.Model?.DisplayValue || "",
          category: inferCategory(title),
          image_url: img,
          msrp_price: basis,
          current_price: price,
          percent_off,
          availability_type: "new",
          affiliate_source: "amazon",
          affiliate_url: `https://www.amazon.com/dp/${asin}?tag=${TAG}`
        };
      })
      .filter(Boolean);

    res.json(deals);
  } catch (e) {
    res.status(500).json({ error: "failed", detail: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`Deal sync running on ${PORT}`));

import express from "express";
import paapi from "amazon-paapi";

const app = express();
const PORT = process.env.PORT || 3000;

const TAG = process.env.AMAZON_PARTNER_TAG; // giftjet0a-20
const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
const SECRET_KEY = process.env.AMAZON_SECRET_KEY;

const client = {
  accessKey: ACCESS_KEY,
  secretKey: SECRET_KEY,
  partnerTag: TAG,
  host: "webservices.amazon.com",
  region: "us-east-1"
};

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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/deals", async (req, res) => {
  try {
    const brand = String(req.query.brand || "").trim();
    if (!brand) {
      return res.status(400).json({ error: "brand required" });
    }

    const result = await paapi.SearchItems(
      {
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
      },
      client
    );

    const items = result?.SearchResult?.Items || [];

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
  } catch (err) {
    res.status(500).json({ error: "failed", detail: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Deal sync service running on ${PORT}`);
});

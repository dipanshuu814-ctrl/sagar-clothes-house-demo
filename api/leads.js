export default async function handler(req, res) {
  try {
    const city = String(req.query.city || "").trim();
    const category = String(req.query.category || "").trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    if (!city) {
      return res.status(400).json({ error: "City is required" });
    }

    const geoURL =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(city);

    const geoResponse = await fetch(geoURL, {
      headers: {
        "User-Agent": "AI-Lead-Finder/1.0"
      }
    });

    if (!geoResponse.ok) {
      throw new Error("Location service unavailable");
    }

    const geo = await geoResponse.json();

    if (!geo.length) {
      return res.status(404).json({ error: "City not found" });
    }

    const lat = Number(geo[0].lat);
    const lon = Number(geo[0].lon);

    const query = `
[out:json][timeout:25];
(
  nwr["name"](around:15000,${lat},${lon});
);
out center tags;
`;

    const servers = [
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter"
    ];

    let data = null;

    for (const server of servers) {
      try {
        const response = await fetch(server, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "AI-Lead-Finder/1.0"
          },
          body: "data=" + encodeURIComponent(query)
        });

        if (response.ok) {
          data = await response.json();
          break;
        }
      } catch (e) {}
    }

    if (!data) {
      throw new Error("Business search service unavailable");
    }

    const businesses = (data.elements || [])
      .map((item) => {
        const tags = item.tags || {};

        return {
          business_name: tags.name || "",
          category:
            tags.shop ||
            tags.amenity ||
            tags.office ||
            category ||
            "",
          city,
          phone: tags.phone || tags["contact:phone"] || "",
          email: tags.email || tags["contact:email"] || "",
          website: tags.website || tags["contact:website"] || "",
          instagram: tags["contact:instagram"] || "",
          website_status:
            tags.website || tags["contact:website"]
              ? "has_website"
              : "unknown",
          lead_status: "new",
          notes: "Discovered via OpenStreetMap"
        };
      })
      .filter((business) => {
        if (!business.business_name) return false;
        if (!category) return true;

        const text = (
          business.business_name +
          " " +
          business.category
        ).toLowerCase();

        return text.includes(category);
      })
      .slice(0, limit);

    return res.status(200).json({
      city,
      category,
      count: businesses.length,
      businesses
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Lead search failed"
    });
  }
}
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const city = String(req.query.city || "").trim();
    const category = String(req.query.category || "").trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    if (!city) {
      return res.status(400).json({ error: "City is required" });
    }

    const started = Date.now();

    const geoURL =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(city);

    const geoResponse = await fetch(geoURL, {
      headers: { "User-Agent": "AI-Lead-Finder/1.0" }
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
      } catch {}
    }

    if (!data) {
      throw new Error("Business search service unavailable");
    }

    const businesses = (data.elements || [])
      .map((item) => {
        const tags = item.tags || {};

        return {
          name: tags.name || "",
          category:
            tags.shop ||
            tags.amenity ||
            tags.office ||
            "",
          city,
          phone:
            tags.phone ||
            tags["contact:phone"] ||
            "",
          email:
            tags.email ||
            tags["contact:email"] ||
            "",
          website:
            tags.website ||
            tags["contact:website"] ||
            "",
          instagram:
            tags["contact:instagram"] ||
            "",
          status: "new",
          source: "OpenStreetMap"
        };
      })
      .filter((business) => {
        if (!business.name) return false;

        if (!category) return true;

        return (
          business.name + " " + business.category
        )
          .toLowerCase()
          .includes(category);
      })
      .slice(0, limit);

    if (!businesses.length) {
      return res.status(200).json({
        success: true,
        city,
        category,
        count: 0,
        businesses: []
      });
    }

    const { data: savedBusinesses, error: businessError } =
      await supabase
        .from("businesses")
        .insert(businesses)
        .select();

    if (businessError) {
      throw new Error(businessError.message);
    }

    const leads = savedBusinesses.map((b) => ({
      business_name: b.name,
      category: b.category,
      city: b.city,
      Phone: b.phone,
      email: b.email,
      Website: b.website,
      instagram: b.instagram,
      website_status: b.website
        ? "has_website"
        : "no_website",
      leads_status: "new",
      notes: "Discovered via AI Lead Finder"
    }));

    const { error: leadError } = await supabase
      .from("Leads")
      .insert(leads);

    if (leadError) {
      throw new Error(leadError.message);
    }

    const { error: runError } = await supabase
      .from("agent_runs")
      .insert({
        agent_name: "Business Finder",
        run_type: "lead_discovery",
        status: "completed",
        input_data: {
          city,
          category,
          limit
        },
        output_data: {
          count: savedBusinesses.length
        },
        duration_ms: Date.now() - started
      });

    if (runError) {
      throw new Error(runError.message);
    }

    return res.status(200).json({
      success: true,
      city,
      category,
      count: savedBusinesses.length,
      businesses: savedBusinesses
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Lead search failed"
    });
  }
}
"""Every constant the calculation engine uses, with its source or a flag that it is an assumption.

All values live in one frozen dataclass so the engine stays pure (it receives a CalcConfig)
and so tests can override any value:  dataclasses.replace(DEFAULT_CONFIG, gal_per_vehicle_year=500).
Items marked ASSUMPTION are not sourced; the Results page must show them as assumptions.
"""

from dataclasses import dataclass

EIA_CHOKEPOINTS_URL = "https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints"
ICCT_URL = "https://theicct.org/wp-content/uploads/2024/02/ID-85-%E2%80%93-EV-supply-chain-Report-Letter-70112-v3.pdf"
IEA_GEVO_URL = "https://www.iea.org/reports/global-ev-outlook-2026"
USGS_LITHIUM_URL = "https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf"
IMF_SPEECH_URL = "https://www.imf.org/en/news/articles/2026/03/09/sp030926-coping-and-thriving-in-a-fluid-world"
IMF_WP17196_URL = "https://www.imf.org/en/publications/wp/issues/2017/09/05/oil-prices-and-inflation-dynamics-evidence-from-advanced-and-developing-economies-45180"


@dataclass(frozen=True)
class MacroCoefficient:
    """One cited rule of thumb: effect of a +10% oil price rise. A coefficient with no verified source is not allowed here."""
    key: str
    label: str
    unit: str            # "pp" (percentage points) or "% of output"
    low: float           # equal to high when the source gives a single point
    high: float
    source: str
    source_url: str
    year: int
    quote: str           # the exact sentence the figure comes from
    corroboration: str = ""


# Verified against the primary source on 2026-10-25 (the page text was read, not a search summary).
# NOT included because no primary source was verified: World Bank 0.5 pp (PRWP 10648) and the IMF MENAP importer figures
# (-0.5 pp output, +1.0 pp inflation): the regional-outlook PDF could not be retrieved, so they are left out rather than guessed.
MACRO_COEFFICIENTS = (
    MacroCoefficient(
        key="global_inflation_pp", label="Global headline inflation", unit="pp", low=0.4, high=0.4,
        source="IMF Managing Director K. Georgieva, keynote speech, Japan Ministry of Finance symposium", source_url=IMF_SPEECH_URL, year=2026,
        quote="Every 10 percent increase in oil prices results in a 40 basis point increase in global headline inflation "
              "[assuming the increase lasts through most of the year].",
        corroboration="IMF Working Paper 17/196 (Choi, Furceri, Loungani, Mishra, Ribeiro, 2017): a 10% rise in global oil inflation lifts "
                      "domestic inflation by about 0.4 percentage point on impact, fading within roughly two years.",
    ),
    MacroCoefficient(
        key="global_output_pct", label="Global output", unit="% of output", low=-0.2, high=-0.1,
        source="IMF Managing Director K. Georgieva, keynote speech, Japan Ministry of Finance symposium", source_url=IMF_SPEECH_URL, year=2026,
        quote="Every 10 percent increase in oil prices results in ... a 0.1-0.2 percent fall in global output "
              "[assuming the increase lasts through most of the year].",
    ),
)


@dataclass(frozen=True)
class CalcConfig:
    # --- supply and price -------------------------------------------------
    # EIA world total oil supply, 2024 (Table 1, World Oil Transit Chokepoints, STEO Feb 2026).
    global_supply_bpd: float = 103_300_000.0
    # Phase 1 validated formula  %dP = %dS / |Ed|. Ed = -0.15 (borrowed textbook short-run value).
    # Must equal the 'elasticity' stored in data/price_surge_baseline.joblib (checked by a test).
    elasticity_abs: float = 0.15
    # Leave-one-out MAE of the formula on 21 daily-resolution events (phase1_analysis.py: 13.09).
    price_band_pp: float = 13.09
    # ASSUMPTION: price decays exponentially toward baseline after the disruption ends.
    # Half-life default = duration/2 clamped to [min, max] days (short disruptions fade fast).
    half_life_min_days: float = 7.0
    half_life_max_days: float = 60.0
    trajectory_days: int = 180

    # --- fleet and detour -------------------------------------------------
    # Project tanker speed (brief section 4.5).
    tanker_knots: float = 14.0

    # --- EV substitution --------------------------------------------------
    # 1 barrel = 42 gal crude; typical refinery yields ~19.5 gal gasoline (project brief; matches ev_lithium.py).
    gasoline_gal_per_bbl: float = 19.5
    # ASSUMPTION: 500 gal of gasoline per vehicle-year (a US-style figure; the global average is lower,
    # which would make the EV counts HIGHER). From the project brief.
    gal_per_vehicle_year: float = 500.0
    # IEA Global EV Outlook 2026: electric car sales "exceed 20 million in 2025"; almost 22 million produced.
    current_global_ev_sales_per_year: float = 20_000_000.0
    current_global_ev_production_per_year: float = 22_000_000.0
    horizons_years: tuple = (1, 3, 5)

    # --- lithium ----------------------------------------------------------
    # USGS reports lithium CONTENT; LCE = Li x 5.323 (Li2CO3 molar mass / 2 Li; stoichiometry).
    lce_per_t_li: float = 5.323
    # Project assumption from the brief: 0.008 t LCE per EV (about 8 kg). UNSOURCED, and low.
    lce_t_per_ev_project: float = 0.008
    # Sourced case: NMC-811 cathodes contain about 0.10 kg Li per kWh (ICCT, Feb 2024, p.17).
    li_kg_per_kwh: float = 0.10
    # IEA GEVO 2026: average BEV battery in 2025 'below 60 kWh' in China, 'close to 70 kWh' in the EU,
    # 90 kWh in the US. 60 kWh is used as a typical global pack (China is the largest market).
    typical_pack_kwh: float = 60.0
    # Sensitivity: the other IEA GEVO 2026 regional BEV pack sizes (EU 'close to 70 kWh', US 90 kWh).
    pack_cases: tuple = (("China, below 60 kWh (headline)", 60.0), ("EU, close to 70 kWh", 70.0), ("US, 90 kWh", 90.0))
    # Chemistry caveat shown beside every sourced lithium figure.
    chemistry_caveat: str = (
        "The 0.10 kg Li per kWh figure is for NMC-811 cathodes (ICCT 2024). LFP, which dominates in China, is not covered "
        "by a sourced figure here, so the sourced case may over- or under-state lithium for LFP-heavy fleets.")
    # Which case the Results page calls the headline: "sourced" or "project".
    lithium_headline_case: str = "sourced"
    # USGS MCS 2026 world mine production, tonnes lithium content (2025 estimate), excl. US.
    world_li_production_t_li: float = 290_000.0
    world_li_reserves_t_li: float = 37_000_000.0

    # --- macro rules of thumb (indicative; every coefficient is cited in MACRO_COEFFICIENTS above) ---
    macro_coefficients: tuple = MACRO_COEFFICIENTS
    # ASSUMPTION: the IMF figures assume the oil price rise lasts through most of a year, so effects are scaled linearly
    # by min(duration_days, 365) / 365 (the source gives no figure for shorter shocks).
    macro_full_effect_days: float = 365.0
    # Year of the EV sales/production figures above (IEA Global EV Outlook 2026).
    current_ev_data_year: int = 2025


DEFAULT_CONFIG = CalcConfig()

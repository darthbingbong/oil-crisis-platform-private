/** Shown in the info tooltip and in the README: what AIS can and cannot tell you. */
export const AIS_LIMITS = [
  "Coverage has gaps: the free feed is built from receivers near coasts, so open-ocean stretches can be empty.",
  "Vessels can switch their transponder off, especially around the Gulf and in sanctioned trades. A missing ship is not an absent ship.",
  "Destination is typed in by the crew and is often stale, abbreviated or wrong.",
  "Free tiers are limited (AISStream: 3 connections per account, no uptime guarantee), so the feed can stall.",
  "AIS does not say what a tanker is carrying, or whether it is loaded. Type 80 to 89 only means tanker.",
];

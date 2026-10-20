import type { PublicScenario } from "./types";

export const SCENARIOS: PublicScenario[] = [
  {
    id: "client-price",
    title: "The Discount Demand",
    category: "Freelance / Sales",
    tagline: "A client with budget sign-off authority wants 30% off your quote.",
    counterpart: {
      name: "Dana Whitfield",
      role: "Head of Marketing",
      org: "Northwind Studio",
      initials: "DW",
      accentLabel: "Direct · Numbers-driven",
      visibleProfile: [
        "You were quoted £9,500 for a six-week brand refresh.",
        "Dana believes that is roughly 30% above her budget.",
        "Her team already shortlisted you — this call decides the spend.",
      ],
    },
    voice: { id: "4SZHfMpw-p46Ywgs", name: "Harper" },
    briefing: {
      situation:
        "A kickoff call to confirm the engagement. Procurement sign-off depends on the price, and Dana has come prepared to negotiate.",
      yourGoal:
        "Protect your rate. Justify the value or trade scope — never your day rate — if you concede anything.",
      stakes:
        "Lose the project or win it at a price that undercuts the next twelve months of your pipeline.",
    },
  },
  {
    id: "investor-grilling",
    title: "The Investor Grilling",
    category: "Fundraising",
    tagline: "A seed investor tests your traction, differentiation and why-now.",
    counterpart: {
      name: "Marcus Reed",
      role: "Partner",
      org: "Halcyon Ventures",
      initials: "MR",
      accentLabel: "Fast · Skeptical of vanity metrics",
      visibleProfile: [
        "Leads pre-seed and seed checks between £250k and £750k.",
        "Takes pitches quickly and drops ones that feel vague.",
        "This is a partner call after a warm intro.",
      ],
    },
    voice: { id: "r2sIQdqqoqgRJuXw", name: "Marcus" },
    briefing: {
      situation:
        "A 30-minute partner call. Marcus is deciding whether to take a second meeting and start diligence.",
      yourGoal:
        "Earn the second meeting by showing real traction, a clear reason you win, and a credible plan.",
      stakes:
        "A second meeting unlocks diligence and a term sheet; a vague call ends the conversation.",
    },
  },
  {
    id: "hiring-interview",
    title: "The Experience Interrogation",
    category: "Job search",
    tagline: "A hiring manager probes every vague answer until it gets specific.",
    counterpart: {
      name: "Priya Nair",
      role: "Engineering Manager",
      org: "Meridian",
      initials: "PN",
      accentLabel: "Rigorous · Allergic to buzzwords",
      visibleProfile: [
        "Hiring a Senior Product Engineer for a platform team.",
        "Known for probing weak answers until they become concrete.",
        "This is the final round before a decision.",
      ],
    },
    voice: { id: "SG3KnxbSOkkrY097", name: "Lauren" },
    briefing: {
      situation:
        "The final-round interview. Priya is testing depth, ownership and how you handle hard trade-offs.",
      yourGoal:
        "Show that you have owned consequential technical decisions end-to-end, with specifics and outcomes.",
      stakes:
        "A strong call moves you to offer; a rehearsed-sounding one drops you to the back of the pack.",
    },
  },
  {
    id: "customer-escalation",
    title: "The Difficult Customer",
    category: "Customer success",
    tagline: "An escalated account wants accountability, not an explanation.",
    counterpart: {
      name: "Tom Bradley",
      role: "Operations Director",
      org: "Kestrel Logistics",
      initials: "TB",
      accentLabel: "Frustrated · Wants a plan",
      visibleProfile: [
        "Escalated after a service outage delayed their deliveries.",
        "Has said this is not the first incident this quarter.",
        "Has the authority to terminate the contract.",
      ],
    },
    voice: { id: "POBHtemksfWQbng0", name: "Garrett" },
    briefing: {
      situation:
        "A recovery call booked after the incident. Tom is on the edge of churning and wants concrete ownership.",
      yourGoal:
        "De-escalate, take real ownership, and leave with an agreed, dated recovery plan.",
      stakes:
        "A badly handled call loses the account and the renewal attached to it.",
    },
  },
];

export function getScenario(id: string): PublicScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

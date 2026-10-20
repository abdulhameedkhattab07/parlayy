export interface VoiceOption {
  id: string;
  name: string;
  gender: "masculine" | "feminine";
  vibe: string;
}

export const VOICES: VoiceOption[] = [
  {
    id: "4SZHfMpw-p46Ywgs",
    name: "Harper",
    gender: "feminine",
    vibe: "warm, brisk, commercially sharp",
  },
  {
    id: "r2sIQdqqoqgRjuXw",
    name: "Marcus",
    gender: "masculine",
    vibe: "crisp, fast, skeptical",
  },
  {
    id: "SG3KnxbSOkkrY097",
    name: "Lauren",
    gender: "feminine",
    vibe: "calm, precise, rigorous",
  },
  {
    id: "POBHtemksfWQbng0",
    name: "Garrett",
    gender: "masculine",
    vibe: "direct, grounded, frustrated",
  },
  {
    id: "YTpq7expH9539ERJ",
    name: "Emma",
    gender: "feminine",
    vibe: "measured, authoritative, executive",
  },
  {
    id: "LFZvm12tW_z0xfGo",
    name: "Kent",
    gender: "masculine",
    vibe: "senior, deliberate, institutional",
  },
  {
    id: "KWJiFWu2O9nMPYcR",
    name: "John",
    gender: "masculine",
    vibe: "steady, plain-spoken, operational",
  },
  {
    id: "ubuXFxVQwVYnZQhy",
    name: "Eva",
    gender: "feminine",
    vibe: "crisp, analytical, cool",
  },
  {
    id: "m86j6D7UZpGzHsNu",
    name: "Jack",
    gender: "masculine",
    vibe: "relaxed, confident, commercial",
  },
];

export function getVoice(id: string): VoiceOption | undefined {
  return VOICES.find((v) => v.id === id);
}

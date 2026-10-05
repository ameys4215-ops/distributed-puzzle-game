import heroImage from "../assets/hero.png";

export const PUZZLE_IMAGES = [
  {
    id: "nature",
    name: "🌄 Mountain Vista",
    url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=700&q=80"
  },
  {
    id: "space",
    name: "🌌 Cosmic Nebula",
    url: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=700&q=80"
  },
  {
    id: "cyberpunk",
    name: "🏙️ Neon City",
    url: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=700&q=80"
  },
  {
    id: "hero",
    name: "⭐ Hero Art",
    url: heroImage
  }
];

export function getImageById(id) {
  return PUZZLE_IMAGES.find((img) => img.id === id) || PUZZLE_IMAGES[0];
}

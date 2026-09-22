import { useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "./Common";

const groups: { name: string; emojis: [string, string][] }[] = [
  {
    name: "Smileys & feelings",
    emojis: [
      ["😀", "Grinning happy"],
      ["😃", "Big smile"],
      ["😊", "Smiling blush"],
      ["😁", "Beaming grin"],
      ["😂", "Laughing tears of joy"],
      ["🤣", "Rolling laughing"],
      ["😉", "Wink"],
      ["😍", "Heart eyes love"],
      ["🥰", "Feeling loved"],
      ["😘", "Blowing a kiss"],
      ["😎", "Cool sunglasses"],
      ["🤩", "Star struck excited"],
      ["🥳", "Party celebration"],
      ["😋", "Yummy delicious"],
      ["😜", "Playful tongue"],
      ["🤔", "Thinking"],
      ["🤗", "Hug"],
      ["🫡", "Salute"],
      ["😅", "Nervous relieved smile"],
      ["😌", "Relieved peaceful"],
      ["😴", "Sleeping tired"],
      ["😮", "Surprised wow"],
      ["🥺", "Pleading puppy eyes"],
      ["😢", "Sad crying"],
      ["😭", "Sobbing"],
      ["😤", "Frustrated"],
      ["😡", "Angry"],
      ["🤯", "Mind blown"],
    ],
  },
  {
    name: "Gestures & people",
    emojis: [
      ["👋", "Wave hello goodbye"],
      ["👍", "Thumbs up yes agree"],
      ["👎", "Thumbs down no"],
      ["👏", "Clap applause"],
      ["🙌", "Celebrate raised hands"],
      ["🙏", "Thanks please prayer"],
      ["🤝", "Handshake agreement"],
      ["👌", "Okay perfect"],
      ["✌️", "Peace victory"],
      ["🤞", "Fingers crossed luck"],
      ["💪", "Strong muscle"],
      ["🫶", "Heart hands love"],
      ["👀", "Eyes looking"],
      ["🧠", "Brain idea"],
      ["💃", "Dancing"],
      ["🧑‍💻", "Working coder"],
    ],
  },
  {
    name: "Hearts & celebration",
    emojis: [
      ["❤️", "Red heart love"],
      ["🧡", "Orange heart"],
      ["💛", "Yellow heart"],
      ["💚", "Green heart"],
      ["💙", "Blue heart"],
      ["💜", "Purple heart"],
      ["🩷", "Pink heart"],
      ["🖤", "Black heart"],
      ["🤍", "White heart"],
      ["💔", "Broken heart"],
      ["💕", "Two hearts"],
      ["💯", "Hundred perfect"],
      ["🔥", "Fire hot"],
      ["✨", "Sparkles magic"],
      ["⭐", "Star"],
      ["🎉", "Party popper celebration"],
      ["🎊", "Confetti"],
      ["🎈", "Balloon"],
      ["🎁", "Gift present"],
      ["🏆", "Trophy winner"],
    ],
  },
  {
    name: "Nature & animals",
    emojis: [
      ["🐶", "Dog puppy"],
      ["🐱", "Cat kitten"],
      ["🐼", "Panda"],
      ["🦊", "Fox"],
      ["🦋", "Butterfly"],
      ["🐝", "Bee"],
      ["🌸", "Cherry blossom flower"],
      ["🌻", "Sunflower"],
      ["🌱", "Seedling plant"],
      ["🌈", "Rainbow"],
      ["☀️", "Sun sunny"],
      ["🌙", "Moon night"],
      ["🌊", "Ocean wave"],
      ["❄️", "Snowflake winter"],
    ],
  },
  {
    name: "Food & activities",
    emojis: [
      ["☕", "Coffee tea"],
      ["🍕", "Pizza"],
      ["🍔", "Burger"],
      ["🍟", "Fries"],
      ["🍩", "Donut"],
      ["🍰", "Cake birthday"],
      ["🍦", "Ice cream"],
      ["🥑", "Avocado"],
      ["🍓", "Strawberry"],
      ["🍿", "Popcorn movie"],
      ["🎮", "Game controller"],
      ["🎵", "Music note"],
      ["🎨", "Art palette design"],
      ["⚽", "Football soccer"],
      ["🏀", "Basketball"],
      ["🚀", "Rocket launch"],
      ["💡", "Light bulb idea"],
      ["📚", "Books study"],
      ["✅", "Check done"],
      ["💬", "Chat speech"],
    ],
  },
];

export function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const filtered = groups
    .map((group) => ({
      ...group,
      emojis: group.emojis.filter(([emoji, label]) =>
        `${emoji} ${label} ${group.name}`.toLowerCase().includes(search),
      ),
    }))
    .filter((group) => group.emojis.length > 0);

  return (
    <Modal title="Pick an emoji" onClose={onClose}>
      <div className="search-field">
        <Search size={18} />
        <input
          autoFocus
          aria-label="Search emojis"
          placeholder="Search smile, heart, coffee…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="emoji-picker-groups">
        {filtered.map((group) => (
          <section key={group.name}>
            <h3>{group.name}</h3>
            <div className="emoji-grid">
              {group.emojis.map(([emoji, label]) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={() => onSelect(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
        {!filtered.length && (
          <p className="muted" role="status">
            No emojis found. Try another search.
          </p>
        )}
      </div>
    </Modal>
  );
}

type IconName = "back" | "forward" | "reload" | "home" | "bookmark" | "star" | "folder" | "folderAdd" | "shield" | "close" | "check" | "trash" | "edit" | "up" | "down" | "grip" | "cards" | "first" | "last" | "eye" | "due";

const paths: Record<IconName, string> = {
  back: "m14 5-7 7 7 7M7 12h14",
  forward: "m10 5 7 7-7 7M3 12h14",
  reload: "M20 7v5h-5M20 12a8 8 0 1 0-2 5",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  bookmark: "M6 3h12v18l-6-4-6 4V3Z",
  star: "m12 2 3 6.5 7 .9-5.1 5 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9L12 2Z",
  folder: "M3 7V4h6l2 3h10v13H3V7Z",
  folderAdd: "M3 7V4h6l2 3h10v13H3V7Zm6 7h6m-3-3v6",
  shield: "M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7l-9-4Z",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  edit: "M4 20l4-.8L20 7l-3-3L5 16l-1 4Zm10-13 3 3",
  up: "m5 14 7-7 7 7",
  down: "m5 10 7 7 7-7",
  cards: "M8 3h12v15H8V3ZM4 7v14h12",
  first: "M5 5v14m14-14-7 7 7 7",
  last: "M19 5v14M5 5l7 7-7 7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  due: "M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 4v5l3 2",
  grip: "M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1",
};

export function ActionIcon({ name }: { name: IconName }) {
  return <svg className="browser-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

import { hskVocabulary, levelLabel, studyData, type StudyStatus, type Vocab } from "../hsk/study";
import { convertScriptText } from "../read/scriptMode";

let index: Promise<Map<string, Vocab[]>> | undefined;
function vocabularyIndex() {
  return index ??= hskVocabulary().then((rows) => {
    const words = new Map<string, Vocab[]>();
    for (const row of rows) {
      const matches = words.get(row.word);
      if (matches) matches.push(row);
      else words.set(row.word, [row]);
    }
    return words;
  }).catch((error) => { index = undefined; throw error; });
}

const LABELS: Record<StudyStatus, string> = {
  unlearned: "Unlearned", review: "Review", memorized: "Mastered",
};

function readingKey(value: string): string {
  return value.toLowerCase().normalize("NFC").replace(/[\s’'·-]/g, "");
}

export function dictionaryHsk(section: HTMLElement, list: HTMLElement, words: string[], pinyin?: string): () => void {
  let request = 0;
  let writing = false;
  let controls: { row: Vocab; select: HTMLSelectElement }[] | undefined;
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.hidden = true;
  section.appendChild(message);

  async function refresh() {
    if (!section.isConnected || writing) return;
    const id = ++request;
    try {
      const byWord = await vocabularyIndex();
      if (id !== request || !section.isConnected) return;
      if (!controls) {
        const unique = new Map<string, Vocab>();
        for (const word of words) {
          const matches = byWord.get(word) ?? byWord.get(convertScriptText(word, "simp")) ?? [];
          for (const row of matches) {
            if (!pinyin || readingKey(row.pinyin) === readingKey(pinyin)) unique.set(row.id, row);
          }
        }
        controls = [...unique.values()].map((row) => {
          const item = document.createElement("div");
          item.className = "dict-hsk-item";
          const link = document.createElement("a");
          link.href = "/hsk?" + new URLSearchParams({ level: row.level, word: row.word });
          link.target = "_blank";
          link.textContent = levelLabel(row.level);
          const gloss = document.createElement("div");
          gloss.textContent = row.pinyin + " · " + row.meaning;
          const select = document.createElement("select");
          select.setAttribute("aria-label", "HSK study status for " + row.word + " " + row.pinyin);
          select.disabled = true;
          for (const [value, label] of Object.entries(LABELS)) select.add(new Option(label, value));
          select.addEventListener("change", async () => {
            const before = select.dataset.saved ?? "unlearned";
            writing = true;
            ++request;
            controls?.forEach((control) => { control.select.disabled = true; });
            try {
              await studyData({ statuses: { [row.id]: select.value as StudyStatus } });
              message.hidden = true;
            } catch {
              select.value = before;
              message.textContent = "Could not save HSK study status.";
              message.hidden = false;
              controls?.forEach((control) => { control.select.disabled = false; });
              return;
            } finally { writing = false; }
            void refresh();
          });
          item.append(link, select, gloss);
          list.appendChild(item);
          return { row, select };
        });
      }
      section.hidden = controls.length === 0;
      if (!controls.length) return;
      const saved = await studyData();
      if (id !== request || !section.isConnected) return;
      for (const { row, select } of controls) {
        select.value = saved.statuses[row.id] ?? "unlearned";
        select.dataset.saved = select.value;
        select.disabled = false;
      }
      message.hidden = true;
    } catch {
      if (id !== request || !section.isConnected) return;
      message.textContent = "Could not load HSK study status.";
      message.hidden = false;
      section.hidden = false;
    }
  }

  void refresh();
  return () => { void refresh(); };
}

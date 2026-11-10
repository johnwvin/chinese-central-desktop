import { useState } from "react";
import { HubPage } from "./HubPage";
import "./games.css";

const digits = "零一二三四五六七八九";
function chinese(n: number) {
  return n < 10 ? digits[n] : (n < 20 ? "" : digits[Math.floor(n / 10)]) + "十" + (n % 10 ? digits[n % 10] : "");
}
function makeDate() {
  const day = new Date(2000, 0, 1 + Math.floor(Math.random() * 14610));
  const year = String(day.getFullYear()).split("").map((digit) => digits[Number(digit)]).join("");
  const core = year + "年" + chinese(day.getMonth() + 1) + "月" + chinese(day.getDate());
  const prompt = day.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return { prompt, answers: [core + "日", core + "号"] };
}
function makeTime() {
  const hour = 1 + Math.floor(Math.random() * 12);
  const minute = Math.floor(Math.random() * 60);
  const heads = hour === 2 ? ["两点", "二点"] : [chinese(hour) + "点"];
  const endings = minute === 0 ? ["", "整"] : [minute < 10 ? "零" + chinese(minute) + "分" : chinese(minute) + "分"];
  if (minute === 15) endings.push("一刻");
  if (minute === 30) endings.push("半");
  if (minute === 45) endings.push("三刻");
  return { prompt: String(hour) + ":" + String(minute).padStart(2, "0"), answers: heads.flatMap((head) => endings.map((end) => head + end)) };
}

export function Games() {
  const game = new URLSearchParams(location.search).get("game");
  return <HubPage name="games">
    <h1>Study Tools</h1>
    {game === "date" || game === "time" ? <Practice key={game} game={game} /> : <div className="practice-links">
      <a className="btn" href="/games?game=date" target="_blank">📅 Type the date</a>
      <a className="btn" href="/games?game=time" target="_blank">🕒 Tell the time</a>
    </div>}
  </HubPage>;
}

function Practice({ game }: { game: "date" | "time" }) {
  const make = game === "date" ? makeDate : makeTime;
  const [round, setRound] = useState(make);
  const [entry, setEntry] = useState("");
  const [result, setResult] = useState<"correct" | "wrong" | "shown" | null>(null);
  const check = () => {
    if (result === "correct" || result === "shown") {
      setRound(make());
      setEntry("");
      setResult(null);
      return;
    }
    const value = entry.replace(/[\s。]/g, "").replace(/〇/g, "零").replace(/點/g, "点").replace(/號/g, "号").replace(/兩/g, "两");
    setResult(round.answers.includes(value) ? "correct" : "wrong");
  };
  return <form className="date-time-practice" onSubmit={(event) => { event.preventDefault(); check(); }}>
    <h2>{game === "date" ? "Type the date" : "Tell the time"}</h2>
    <p className="practice-prompt">{round.prompt}</p>
    <input aria-label="Answer in Chinese" lang="zh" value={entry} autoFocus
      onChange={(event) => { setEntry(event.target.value); setResult(null); }} />
    <div className="practice-links">
      <button className="btn accent" type="submit" disabled={!entry.trim() && result !== "shown"}>{result === "correct" || result === "shown" ? "Next" : "Check"}</button>
      {result !== "correct" && result !== "shown" && <button className="btn" type="button" onClick={() => setResult("shown")}>Show answer</button>}
    </div>
    <output aria-live="polite">{result === "correct" ? "Correct" : result === "wrong" ? "Try again" : result === "shown" ? round.answers[0] : ""}</output>
  </form>;
}

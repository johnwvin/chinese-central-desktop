import { Suspense, lazy } from "react";
import { Shell } from "./shell/Shell";
import { Home } from "./pages/Home";
import { Pinyin } from "./pages/Pinyin";
import { Books } from "./pages/Books";
import { Read } from "./pages/Read";
import { Notes } from "./pages/Notes";
import { Games } from "./pages/Games";
import { Dictionary } from "./pages/Dictionary";
import { Ranks } from "./pages/Ranks";
import { Favorites } from "./pages/Favorites";
import { Control } from "./pages/Control";
import { Source } from "./pages/Source";
import { DialogHost } from "./ui/Dialog";

const HskPrep = lazy(() => import("./pages/HskPrep").then((m) => ({ default: m.HskPrep })));

export function App() {
  // Every page is drawn through here, so the one dialog host goes here too:
  // that is what lets any page -- and games/bridge.ts, which is not a
  // component -- call confirmDialog() and be answered in the app's own box
  // rather than the browser's.
  return (
    <>
      <Page />
      <DialogHost />
    </>
  );
}

function Page() {
  switch (window.location.pathname) {
    case "/home":
      return <Home />;
    case "/pinyin":
      return <Pinyin />;
    case "/books":
      return <Books />;
    case "/books/read":
      return <Read />;
    case "/notes":
      return <Notes />;
    case "/games":
      return <Games />;
    case "/hsk":
      return <Suspense fallback={null}><HskPrep /></Suspense>;
    case "/dictionary":
      return <Dictionary />;
    case "/dictionary/ranks":
      return <Ranks />;
    case "/dictionary/favorites":
      return <Favorites />;
    case "/control":
      return <Control />;
    case "/source":
      return <Source />;
    default:
      return <Shell />;
  }
}

export default App;

# Third-party notices

| Bundled material | Source and license |
| --- | --- |
| Chinese–English entries | [CC-CEDICT contributors](https://www.mdbg.net/chinese/dictionary?page=cc-cedict). The [upstream dictionary](https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip) was converted to `dict/cedict.tsv` under [CC BY-SA 4.0](licenses/cc-by-sa-4.0.txt). |
| Character readings and properties | [Unicode Unihan Database](https://www.unicode.org/charts/unihan.html). Selected fields from [Unihan.zip](https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip) were converted to TSV under the [Unicode License](licenses/Unicode.txt). |
| Word segmentation | [jieba](https://github.com/fxsjy/jieba). Its [word list](https://github.com/fxsjy/jieba/blob/master/jieba/dict.txt) was adapted to TSV under the [MIT License](licenses/jieba.txt). |
| Character frequency ranks | [hanziDB.csv](https://github.com/ruddfawcett/hanziDB.csv). Rank columns from [hanziDB.csv data](https://github.com/ruddfawcett/hanziDB.csv/blob/master/data/hanziDB.csv) were adapted to TSV under the [MIT License](licenses/hanziDB.txt). |
| Character components | [Make Me a Hanzi](https://github.com/skishore/makemeahanzi), with additional decompositions from [CJKVI](https://github.com/cjkvi/cjkvi-ids/blob/master/ids.txt) and [CHISE](https://gitlab.chise.org/CHISE/ids). See the character data notes below. |
| Stroke order | [Hanzi Writer 3.7.3](https://registry.npmjs.org/hanzi-writer/-/hanzi-writer-3.7.3.tgz) ([MIT](licenses/HanziWriter.txt)) and [Hanzi Writer Data 2.0.1](https://registry.npmjs.org/hanzi-writer-data/-/hanzi-writer-data-2.0.1.tgz) ([Arphic Public License](licenses/Arphic.txt)). The stroke files derive from Arphic Technology fonts via Make Me a Hanzi. |
| Character origins | [Dong Chinese Character Wiki](https://www.dong-chinese.com/wiki), adapted under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). [Source details](dict/DONG-SOURCE.md). |
| Classifiers | Chinese and English Wiktionary via Wiktextract, adapted under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). [Source details](dict/WIKTIONARY_CLASSIFIERS.md). |
| Character conversion | [OpenCC character tables](https://github.com/BYVoid/OpenCC/tree/3ac34aa439a9908dd49fa92b5174b46314787ac2/data/dictionary), [Apache 2.0](licenses/OpenCC.txt). |
| Mandarin syllable recordings | [Audio-cmn 64 kbps syllables](https://github.com/hugolpz/audio-cmn/tree/f759a0f18f27690742957619e1248ed91e9b3f2c/64k/syllabs), recorded by Chen Wang and compiled by Hugo Lopez, PLIDAM, INALCO, with recording support from Nicolas Vion. The MP3s are unchanged. The [upstream notice](https://github.com/hugolpz/audio-cmn/blob/f759a0f18f27690742957619e1248ed91e9b3f2c/README.md#license) states CC BY-SA without a version number. |
| HSK vocabulary | [HearMandarin HSK 3.0 dataset](https://hearmandarin.com/datasets/). Its English teaching glosses were matched to the app’s vocabulary rows under [CC BY 4.0](licenses/cc-by-4.0.txt). Levels and grammar headings refer to the [ChineseTest HSK syllabus](https://www.chinesetest.cn/HSK). The English grammar explanations are original app notes. |
| PDF rendering | [PDF.js 3.11.174 source](https://github.com/mozilla/pdf.js/tree/v3.11.174), [Apache 2.0](licenses/PDFjs.txt). |
| Browser blocking rules | The [EasyList authors](https://easylist.to/) supplied the lists used to derive the host rules. The bundled list retains unconditional domain blocks and exceptions under [CC BY-SA 3.0](licenses/cc-by-sa-3.0.txt). Its header lists the upstream files. |

## Character component data

`dict/mmah.jsonl` is the editable source form of the combined data. It retains selected character fields from [Make Me a Hanzi’s dictionary.txt](https://github.com/skishore/makemeahanzi/blob/master/dictionary.txt) and fills some unnamed decompositions from [CJKVI’s ids.txt](https://github.com/cjkvi/cjkvi-ids/blob/master/ids.txt). The Make Me a Hanzi data derives from Unihan and CJKlib and is available under [LGPL 3.0 or later](licenses/MakeMeAHanzi-LGPL.txt). CJKVI's ids.txt follows the terms of [CHISE IDS](https://gitlab.chise.org/CHISE/ids/-/tree/master), which is available under GPL 2.0 or later. The combined data file is provided under [GPL 3.0](licenses/GPL-3.0.txt). See [Make Me a Hanzi’s original notice](licenses/MakeMeAHanzi-COPYING.txt) and the [CJKVI license information](https://github.com/cjkvi/cjkvi-ids#licenses).

## Software dependencies

The [Windows dependency source index](licenses/DEPENDENCY_SOURCES.md) lists the exact source archives for the native and interface libraries, including the MPL-covered crates. [Dependency license texts](licenses/dependency-license-texts.txt) contains their accompanying notices. See also the [Rust 1.97.1 standard library source](https://github.com/rust-lang/rust/tree/1.97.1/library), [Rust library notices](licenses/rust-standard-library/COPYRIGHT-library.html), and [Go patent grant](licenses/Go-PATENTS.txt).

The native executable uses the loader from [Microsoft WebView2 SDK 1.0.3650.58](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3650.58). See the [SDK license](licenses/WebView2-LICENSE.txt) and [SDK notices](licenses/WebView2-NOTICE.txt). Microsoft provides the WebView2 Runtime separately.

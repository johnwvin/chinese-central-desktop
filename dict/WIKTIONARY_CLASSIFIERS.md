# Classifier supplement

`wiktionary_classifiers.tsv` contains classifiers recorded directly on noun
entries in Chinese Wiktionary. It supplements CC-CEDICT only where the exact
word has no classifier in CC-CEDICT. The columns are simplified headword,
traditional headword, comma-separated simplified classifiers, and source
Wiktionary edition codes (`zh`, `en`).

Source: Chinese Wiktionary, extracted by Wiktextract at
https://kaikki.org/dictionary/downloads/zh/zh-extract.jsonl.gz
and English Wiktionary at
https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl.gz
(downloaded 2026-09-22). Each row is matched to the same written headword in
the app's CC-CEDICT file. The import retains Mandarin-tagged classifiers and
keeps only classifiers shared by all listed noun senses within an edition
when senses differ. English Wiktionary forms must be explicitly tagged `m`
for Mandarin; Cantonese-only forms are excluded.
It does not infer a classifier from a related word or a word's characters.

Wiktionary content is licensed under CC BY-SA 4.0. The source, license, and
transformation are recorded here for attribution and reproducibility:
https://en.wiktionary.org/wiki/Wiktionary:Copyrights
https://creativecommons.org/licenses/by-sa/4.0/


// 日本語 — 直訳しない。美術館の解説板として読める言い方を選ぶ。
//
// 「住所」は使わない。日本語の住所は人が住む場所を指す。作品の座標は「アドレス」だ。
// 韓国語の「주소」は URL にも使えるので、そこから訳すと取り違える。
export default {
  "meta.language": "Japanese",
  "meta.native": "日本語",

  "common.go": "移動",
  "common.cancel": "キャンセル",
  "common.close": "閉じる",

  "stage.label": "展示室です。ドラッグで移動し、ピンチまたはスクロールで拡大、作品を押すと詳しく見られます。矢印キーで隣の作品へ移ります。",
  "stage.hint": "ドラッグして見て回る",

  "controls.language": "言語",
  "controls.search": "作品を探す",
  "controls.floor": "階を移る",
  "controls.random": "別の場所へ",

  "floor.title": "階",
  "floor.name": "{level}階",
  "floor.note": "階ごとに絵のきめが違います。移ると新しい場所から始まります。",

  "sheet.label": "作品情報",
  "sheet.toggle": "情報を折りたたむ・広げる",
  "sheet.copy": "アドレスをコピー",
  "sheet.download": "保存",
  "sheet.original": "原寸",
  "sheet.large": "拡大",
  "sheet.author": "作者不詳・年代不詳",
  "sheet.medium": "混合基数アドレス {bytes}バイト",
  "sheet.accession": "収蔵番号 {id}",
  "sheet.owner": "バベルの美術館 常設収蔵品",
  "sheet.address": "アドレス",
  "sheet.expand": "押して全体を見る",
  "sheet.record": "記録",
  "sheet.floor": "階",
  "sheet.zones": "区画",
  "sheet.addressSize": "アドレス",
  "sheet.quantization": "量子化",
  "sheet.palette": "色",

  "search.title": "作品を探す",
  "search.upload": "絵をアップロード",
  "search.uploadNote": "いちばん近い場所まで歩きます",
  "search.floor": "階",
  "search.or": "または",
  "search.yours": "あなたの絵",
  "search.nearest": "いちばん近い絵",
  "search.goThere": "その場所へ",

  "language.title": "言語",

  "toast.copied": "アドレスをコピーしました",
  "toast.copyFailed": "コピーできませんでした。アドレスは下にあります",
  "toast.saveFailed": "ファイルを保存できませんでした",
  "toast.debug": "デバッグ・アドレスを入れずに保存しました",
  "toast.badAddress": "読めないアドレスです",
  "toast.nothing": "入力がありません",
  "toast.notPicture": "絵ではありません",
  "toast.badPicture": "開けない絵です",
  "toast.projectFailed": "その絵から場所を見つけられませんでした",
  "toast.brokenUrl": "読めないアドレスなので別の場所から始めます",
  "toast.offline": "ネットワークがなくても見られます"
};

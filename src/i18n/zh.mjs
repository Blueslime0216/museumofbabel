// 中文（简体）— 不逐字翻译。用美术馆说明牌上读得顺的说法。
//
// 只做一份简体。detect() 只看语言标签的前一段，所以 zh-TW 也会落到这里。
// 需要繁体时再加 zh-Hant 词典，并让 detect() 认得带地区的标签。
export default {
  "meta.language": "Chinese",
  "meta.native": "中文",

  "common.go": "前往",
  "common.cancel": "取消",
  "common.close": "关闭",

  "stage.label": "这里是展厅。拖动可以走动，捏合或滚动可以放大，点按作品即可细看。方向键移到旁边的作品。",
  "stage.hint": "拖动来逛",

  "controls.language": "语言",
  "controls.search": "寻找作品",
  "controls.floor": "换层",
  "controls.random": "去别处",

  "floor.title": "层",
  "floor.name": "{level}层",
  "floor.note": "每层画的纹理不同。换层后从新的位置开始。",

  "sheet.label": "作品信息",
  "sheet.toggle": "收起·展开信息",
  "sheet.copy": "复制地址",
  "sheet.download": "下载",
  "sheet.original": "原尺寸",
  "sheet.large": "放大",
  "sheet.author": "作者不详·年代不详",
  "sheet.medium": "混合基数地址 {bytes}字节",
  "sheet.accession": "藏品编号 {id}",
  "sheet.owner": "巴别美术馆 常设藏品",
  "sheet.address": "地址",
  "sheet.expand": "点按看全文",
  "sheet.record": "记录",
  "sheet.floor": "层",
  "sheet.zones": "区块",
  "sheet.addressSize": "地址",
  "sheet.quantization": "量化",
  "sheet.palette": "色",

  "search.title": "寻找作品",
  "search.upload": "上传画作",
  "search.uploadNote": "我们走到最相近的位置",
  "search.floor": "层",
  "search.or": "或者",
  "search.yours": "你的画",
  "search.nearest": "最相近的画",
  "search.goThere": "去那里",

  "language.title": "语言",

  "toast.copied": "已复制地址",
  "toast.copyFailed": "无法复制。地址显示在下面",
  "toast.saveFailed": "无法保存文件",
  "toast.debug": "调试·未写入地址就保存了",
  "toast.badAddress": "这个地址读不出来",
  "toast.nothing": "没有输入内容",
  "toast.notPicture": "这不是一幅画",
  "toast.badPicture": "这幅画打不开",
  "toast.projectFailed": "无法从这幅画找出位置",
  "toast.brokenUrl": "地址读不出来，改从别处开始",
  "toast.offline": "没有网络也能看"
};

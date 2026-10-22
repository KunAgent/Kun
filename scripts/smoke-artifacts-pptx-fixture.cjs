'use strict'

// Minimal multi-slide PPTX for the artifacts library smoke: one theme, one
// master, one layout and N title slides, enough for pptx-preview to render a
// deck whose thumbnail rail is taller than the viewer.

const JSZip = require('jszip')

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.presentationml'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function relationships(entries) {
  const items = entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
  return `${XML_HEAD}<Relationships xmlns="${PKG_REL}">${items.join('')}</Relationships>`
}

function emptyTree(extra = '') {
  return '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
    + '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + `<p:grpSpPr/>${extra}</p:spTree></p:cSld>`
}

function titleShape(text) {
  return '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="838200" y="2286000"/><a:ext cx="10515600" cy="1325563"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4400"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
}

const THEME = `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="Smoke"><a:themeElements>`
  + '<a:clrScheme name="Smoke"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
  + '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>'
  + '<a:accent1><a:srgbClr val="C2410C"/></a:accent1><a:accent2><a:srgbClr val="0F766E"/></a:accent2>'
  + '<a:accent3><a:srgbClr val="1D4ED8"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4>'
  + '<a:accent5><a:srgbClr val="BE123C"/></a:accent5><a:accent6><a:srgbClr val="4D7C0F"/></a:accent6>'
  + '<a:hlink><a:srgbClr val="1D4ED8"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Smoke"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="Smoke"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
  + '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
  + '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>'
  + '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'

async function buildSmokePptx(slideTitles) {
  const zip = new JSZip()
  const slideOverrides = slideTitles.map((_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="${CT}.slide+xml"/>`).join('')
  zip.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>`
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + `${slideOverrides}</Types>`)
  zip.file('_rels/.rels', relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']]))
  const slideIds = slideTitles.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join('')
  zip.file('ppt/presentation.xml', `${XML_HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">`
    + `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst>`
    + '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
    + '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>')
  zip.file('ppt/_rels/presentation.xml.rels', relationships([
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'theme', 'theme/theme1.xml'],
    ...slideTitles.map((_, index) => [`rId${index + 3}`, 'slide', `slides/slide${index + 1}.xml`])
  ]))
  zip.file('ppt/theme/theme1.xml', THEME)
  zip.file('ppt/slideMasters/slideMaster1.xml', `${XML_HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">`
    + `${emptyTree()}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"`
    + ' accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>')
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([
    ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'theme', '../theme/theme1.xml']
  ]))
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${XML_HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank">`
    + `${emptyTree()}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([
    ['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']
  ]))
  slideTitles.forEach((title, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, `${XML_HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">`
      + `${emptyTree(titleShape(title))}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, relationships([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']
    ]))
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

module.exports = { buildSmokePptx }

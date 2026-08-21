import JSZip from 'jszip'
import type { WorkBook } from 'xlsx'
import { describe, expect, it } from 'vitest'
import { readXlsxStyleOverrides } from './workspace-xlsx-style-reader'

describe('readXlsxStyleOverrides', () => {
  it('maps worksheet style indexes to supported Univer/OfficeCLI style properties', async () => {
    const zip = new JSZip()
    zip.file('xl/workbook.xml', `
      <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Budget &amp; Plan" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', `
      <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`)
    zip.file('xl/styles.xml', `
      <styleSheet>
        <numFmts count="1"><numFmt numFmtId="164" formatCode="#,#0.00"/></numFmts>
        <fonts count="2">
          <font><sz val="11"/><name val="Calibri"/></font>
          <font><b/><i/><u val="double"/><strike/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/></font>
        </fonts>
        <fills count="3">
          <fill><patternFill patternType="none"/></fill>
          <fill><patternFill patternType="gray125"/></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill>
        </fills>
        <borders count="2">
          <border/>
          <border><left style="thin"><color rgb="FF0000FF"/></left><bottom style="double"/></border>
        </borders>
        <cellXfs count="2">
          <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
          <xf numFmtId="164" fontId="1" fillId="2" borderId="1">
            <alignment horizontal="center" vertical="top" wrapText="1" textRotation="30"/>
          </xf>
        </cellXfs>
      </styleSheet>`)
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" s="1" t="s"><v>0</v></c></row></sheetData></worksheet>')
    const data = await zip.generateAsync({ type: 'uint8array' })

    await expect(readXlsxStyleOverrides(data, { SSF: { 0: 'General' } } as unknown as WorkBook))
      .resolves.toEqual({
        'Budget & Plan': {
          A1: {
            fontFamily: 'Arial',
            fontSize: 14,
            bold: true,
            italic: true,
            underline: 'double',
            strike: true,
            fontColor: '#FF0000',
            fillColor: '#00FF00',
            horizontalAlignment: 'center',
            verticalAlignment: 'top',
            wrap: true,
            numberFormat: '#,#0.00',
            textRotation: 30,
            borders: {
              left: { style: 'thin', color: '#0000FF' },
              bottom: { style: 'double' }
            }
          }
        }
      })
  })
})

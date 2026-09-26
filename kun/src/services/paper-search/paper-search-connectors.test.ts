import { describe, expect, it } from 'vitest'
import { parseOpenReviewSearch } from './paper-search-openreview.js'
import { parsePubmedEfetch, parsePubmedEsearchIds } from './paper-search-pubmed.js'
import { parseHalSearch } from './paper-search-hal.js'
import { parseZenodoSearch } from './paper-search-zenodo.js'
import { parseCoreSearch } from './paper-search-core.js'
import { parseDblpSearch } from './paper-search-dblp.js'
import { containsCjk, jaccardSimilarity, titleTokens } from './paper-search-text.js'

describe('new source parsers (P2.1)', () => {
  it('maps OpenReview notes with venue/year/pdf', () => {
    const hits = parseOpenReviewSearch({
      notes: [
        {
          id: 'TXcifVbFpG',
          forum: 'TXcifVbFpG',
          pdate: new Date('2025-04-24').getTime(),
          content: {
            title: { value: 'RepoAudit' },
            authors: { value: ['Jinyao Guo', 'Chengpeng Wang'] },
            abstract: { value: 'Code auditing.' },
            venue: { value: 'ICLR.cc/2025/Conference Poster' },
            doi: { value: '10.1234/xyz' }
          }
        },
        { id: 'noTitle', content: { authors: { value: ['A'] } } }
      ]
    })
    expect(hits).toEqual([
      {
        title: 'RepoAudit',
        authors: ['Jinyao Guo', 'Chengpeng Wang'],
        abstract: 'Code auditing.',
        year: 2025,
        venue: 'ICLR/2025 Poster',
        doi: '10.1234/xyz',
        arxivId: undefined,
        url: 'https://openreview.net/forum?id=TXcifVbFpG',
        pdfUrl: 'https://openreview.net/pdf?id=TXcifVbFpG'
      }
    ])
  })

  it('parses PubMed esearch ids and efetch XML', () => {
    expect(parsePubmedEsearchIds({ esearchresult: { idlist: ['11', 22] } })).toEqual(['11', '22'])
    const xml = `<PubmedArticleSet><PubmedArticle>
      <MedlineCitation><PMID>12345678</PMID><Article>
        <Journal><Title>Nature</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>A  Study &amp; Test</ArticleTitle>
        <Abstract><AbstractText Label="BACKGROUND">Part one.</AbstractText><AbstractText>Part two.</AbstractText></Abstract>
        <AuthorList><Author><ForeName>Jane</ForeName><LastName>Doe</LastName></Author><Author><CollectiveName>Consortium X</CollectiveName></Author></AuthorList>
        <ELocationID EIdType="doi">10.1038/s41586-024-0001</ELocationID>
      </Article></MedlineCitation>
    </PubmedArticle></PubmedArticleSet>`
    expect(parsePubmedEfetch(xml)).toEqual([
      {
        title: 'A Study & Test',
        authors: ['Jane Doe', 'Consortium X'],
        abstract: 'Part one. Part two.',
        year: 2024,
        venue: 'Nature',
        doi: '10.1038/s41586-024-0001',
        url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/'
      }
    ])
  })

  it('maps HAL docs', () => {
    expect(
      parseHalSearch({
        response: {
          docs: [
            {
              halId_s: 'hal-04000000',
              title_s: ['A HAL Paper'],
              authFullName_s: ['Ada Lovelace'],
              abstract_s: ['HAL abstract.'],
              publicationDateY_i: 2023,
              doiId_s: '10.5678/hal',
              journalTitle_s: 'J. Testing',
              fileMain_s: 'https://hal.science/hal-04000000/file/paper.pdf'
            }
          ]
        }
      })
    ).toEqual([
      {
        title: 'A HAL Paper',
        authors: ['Ada Lovelace'],
        abstract: 'HAL abstract.',
        year: 2023,
        venue: 'J. Testing',
        doi: '10.5678/hal',
        url: 'https://hal.science/hal-04000000',
        pdfUrl: 'https://hal.science/hal-04000000/file/paper.pdf'
      }
    ])
  })

  it('maps Zenodo records and skips non-publication types', () => {
    expect(
      parseZenodoSearch({
        hits: {
          hits: [
            {
              id: 12345,
              metadata: {
                title: 'A Zenodo Preprint',
                creators: [{ name: 'Grace Hopper' }],
                description: 'Zenodo abstract.',
                publication_date: '2024-05-01',
                doi: '10.5281/zenodo.12345',
                resource_type: { type: 'preprint' }
              },
              links: { self_html: 'https://zenodo.org/records/12345' },
              files: [{ key: 'paper.pdf', links: { self: 'https://zenodo.org/api/files/x/paper.pdf' } }]
            },
            {
              id: 999,
              metadata: { title: 'A Dataset', resource_type: { type: 'dataset' } }
            }
          ]
        }
      })
    ).toEqual([
      {
        title: 'A Zenodo Preprint',
        authors: ['Grace Hopper'],
        abstract: 'Zenodo abstract.',
        year: 2024,
        venue: 'Zenodo',
        doi: '10.5281/zenodo.12345',
        url: 'https://zenodo.org/records/12345',
        pdfUrl: 'https://zenodo.org/api/files/x/paper.pdf'
      }
    ])
  })

  it('maps CORE works', () => {
    expect(
      parseCoreSearch({
        results: [
          {
            id: 42,
            title: 'A CORE Work',
            authors: [{ name: 'Alan Turing' }],
            yearPublished: 2022,
            doi: '10.5678/core',
            downloadUrl: 'https://core.ac.uk/download/42.pdf',
            links: [{ type: 'display', url: 'https://core.ac.uk/works/42' }],
            journals: [{ title: 'CORE J.' }]
          }
        ]
      })
    ).toEqual([
      {
        title: 'A CORE Work',
        authors: ['Alan Turing'],
        abstract: undefined,
        year: 2022,
        venue: 'CORE J.',
        doi: '10.5678/core',
        url: 'https://core.ac.uk/works/42',
        pdfUrl: 'https://core.ac.uk/download/42.pdf'
      }
    ])
  })

  it('maps DBLP hits with array or single author', () => {
    expect(
      parseDblpSearch({
        result: {
          hits: {
            hit: [
              {
                info: {
                  title: 'A DBLP Paper.',
                  authors: { author: [{ text: 'Edsger Dijkstra' }, 'Tony Hoare'] },
                  year: '2021',
                  venue: 'ICSE',
                  doi: '10.5678/dblp',
                  ee: 'https://doi.org/10.5678/dblp'
                }
              }
            ]
          }
        }
      })
    ).toEqual([
      {
        title: 'A DBLP Paper',
        authors: ['Edsger Dijkstra', 'Tony Hoare'],
        year: 2021,
        venue: 'ICSE',
        doi: '10.5678/dblp',
        url: 'https://doi.org/10.5678/dblp'
      }
    ])
    expect(parseDblpSearch({ result: { hits: { hit: { info: { title: 'Solo.' } } } } })).toHaveLength(1)
  })
})

describe('fuzzy title matching helpers (P2.4)', () => {
  it('detects CJK text', () => {
    expect(containsCjk('hello')).toBe(false)
    expect(containsCjk('论文 检索')).toBe(true)
  })

  it('token-Jaccard treats reordered titles as the same work', () => {
    const a = titleTokens('Attention Is All You Need')
    const b = titleTokens('Attention is all you need!')
    expect(jaccardSimilarity(a, b)).toBe(1)
    const c = titleTokens('Attention Is Not All You Need')
    expect(jaccardSimilarity(a, c)).toBeLessThan(0.9)
  })
})

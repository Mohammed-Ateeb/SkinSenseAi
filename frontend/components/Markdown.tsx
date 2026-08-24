'use client';
import React from 'react';

/**
 * Tiny dependency-free Markdown renderer for LLM output.
 *
 * Inline parsing is TOGGLE-based (not pair-matched), so malformed/unclosed
 * markers the model sometimes emits (e.g. "**1. Acne …" with no closing **)
 * still render as formatting instead of leaking literal ** / * into the UI.
 * Handles **bold**, *italic*, `code`, bullet/numbered lists, ### headings.
 */

function renderInline(text: string, keyBase: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let buf = '';
  let bold = false, ital = false, code = false;
  let k = 0;

  const flush = () => {
    if (!buf) return;
    let node: React.ReactNode = buf;
    if (code) {
      node = <code style={{ background: 'rgba(201,150,62,0.12)', padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }}>{buf}</code>;
    } else {
      if (ital) node = <em>{node}</em>;
      if (bold) node = <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{node}</strong>;
    }
    nodes.push(<React.Fragment key={`${keyBase}-${k++}`}>{node}</React.Fragment>);
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    if (!code && text.startsWith('**', i)) { flush(); bold = !bold; i += 2; }
    else if (!code && text[i] === '*') { flush(); ital = !ital; i += 1; }
    else if (text[i] === '`') { flush(); code = !code; i += 1; }
    else { buf += text[i]; i += 1; }
  }
  flush();
  return nodes;
}

export default function Markdown({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const items = list.items.map((it, i) => (
      <li key={`${key}-li-${i}`} style={{ marginBottom: 4 }}>{renderInline(it, `${key}-li-${i}`)}</li>
    ));
    blocks.push(
      list.ordered
        ? <ol key={key} style={{ paddingLeft: 20, margin: '6px 0', listStyle: 'decimal' }}>{items}</ol>
        : <ul key={key} style={{ paddingLeft: 20, margin: '6px 0', listStyle: 'disc' }}>{items}</ul>
    );
    list = null;
  };

  lines.forEach((raw, idx) => {
    // Strip stray leading bold/italic markers the model uses as pseudo-numbering
    // ("**1. …", "*2) …") so the list detector below picks them up cleanly.
    let line = raw.trimEnd().replace(/^(\s*)\*{1,2}\s*(?=\d+[.)]\s)/, '$1');
    const key = `b-${idx}`;
    const bullet = line.match(/^\s*[-]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);

    if (bullet) {
      if (list && !list.ordered) list.items.push(bullet[1]);
      else { flushList(`${key}-pre`); list = { ordered: false, items: [bullet[1]] }; }
      return;
    }
    if (numbered) {
      if (list && list.ordered) list.items.push(numbered[1]);
      else { flushList(`${key}-pre`); list = { ordered: true, items: [numbered[1]] }; }
      return;
    }
    flushList(`${key}-flush`);
    if (heading) {
      blocks.push(<div key={key} style={{ fontWeight: 600, color: 'var(--text)', marginTop: 12, marginBottom: 4 }}>{renderInline(heading[1], key)}</div>);
    } else if (line.trim() === '') {
      blocks.push(<div key={key} style={{ height: 8 }} />);
    } else {
      blocks.push(<p key={key} style={{ margin: '0 0 6px' }}>{renderInline(line, key)}</p>);
    }
  });
  flushList('b-final');

  return <div className={className} style={style}>{blocks}</div>;
}

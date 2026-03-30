#!/usr/bin/env node

// ============================================================================
// Follow-Builders — Email Digest Generator
// ============================================================================
// Reads feed-podcasts.json and feed-blogs.json, generates HTML and text
// email digests.
//
// Usage: node prepare-digest-email.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const PODCAST_FEED_PATH = path.join(SCRIPT_DIR, '..', 'feed-podcasts.json');
const BLOG_FEED_PATH = path.join(SCRIPT_DIR, '..', 'feed-blogs.json');
const HTML_OUTPUT = path.join(SCRIPT_DIR, '..', 'digest.html');
const TEXT_OUTPUT = path.join(SCRIPT_DIR, '..', 'digest.txt');

// -- Feed Readers -----------------------------------------------------------

function readPodcastFeed() {
  try {
    if (!fs.existsSync(PODCAST_FEED_PATH)) {
      console.log('Warning: feed-podcasts.json not found, using empty feed');
      return [];
    }
    const data = fs.readFileSync(PODCAST_FEED_PATH, 'utf8');
    const feed = JSON.parse(data);
    return Array.isArray(feed.podcasts) ? feed.podcasts : [];
  } catch (err) {
    console.log(`Warning: Failed to read podcast feed: ${err.message}`);
    return [];
  }
}

function readBlogFeed() {
  try {
    if (!fs.existsSync(BLOG_FEED_PATH)) {
      console.log('Warning: feed-blogs.json not found, using empty feed');
      return [];
    }
    const data = fs.readFileSync(BLOG_FEED_PATH, 'utf8');
    const feed = JSON.parse(data);
    return Array.isArray(feed.posts) ? feed.posts : [];
  } catch (err) {
    console.log(`Warning: Failed to read blog feed: ${err.message}`);
    return [];
  }
}

// -- HTML Generator ---------------------------------------------------------

function generateHTML(podcasts, blogs) {
  const today = new Date().toLocaleDateString('zh-CN');
  const safeToday = typeof today === 'string' ? today : new Date().toISOString().split('T')[0];
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Builders Digest</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #1a1a1a; border-bottom: 3px solid #0066cc; padding-bottom: 15px; margin-bottom: 30px; }
    h2 { color: #0066cc; margin-top: 40px; font-size: 24px; }
    .section { margin: 30px 0; }
    .item { background: #f8f9fa; padding: 20px; margin: 15px 0; border-radius: 10px; border-left: 4px solid #0066cc; }
    .item h3 { margin: 0 0 12px 0; color: #1a1a1a; font-size: 18px; }
    .item p { margin: 8px 0; color: #444; }
    .item a { color: #0066cc; text-decoration: none; font-weight: 500; }
    .item a:hover { text-decoration: underline; }
    .meta { color: #666; font-size: 14px; margin-bottom: 10px; }
    .footer { margin-top: 50px; padding-top: 25px; border-top: 2px solid #eee; color: #666; font-size: 14px; text-align: center; }
    .emoji { font-size: 20px; margin-right: 8px; }
    .empty { color: #999; font-style: italic; padding: 15px 0; }
    .timestamp { color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1><span class="emoji">🤖</span>AI Builders Digest</h1>
    <p class="meta">${safeToday} | 每日 AI 行业精华</p>
`;

  // Podcasts section
  html += `\n    <div class="section">\n      <h2><span class="emoji">🎙️</span>播客精华</h2>\n`;
  
  if (podcasts.length > 0) {
    podcasts.slice(0, 3).forEach(ep => {
      const title = escapeHtml(ep.title || 'Untitled');
      const name = escapeHtml(ep.name || '');
      const url = ep.url ? escapeHtml(ep.url) : '#';
      const publishedAt = formatDate(ep.publishedAt);
      const transcript = ep.transcript || '';
      const summary = transcript.length > 200 ? transcript.substring(0, 200) + '...' : transcript;
      
      html += `
      <div class="item">
        <h3>${title}</h3>
        <p class="meta">${name}${publishedAt ? ' | ' + publishedAt : ''}</p>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
        <p><a href="${url}" target="_blank">收听原文 →</a></p>
      </div>
`;
    });
  } else {
    html += `      <p class="empty">暂无新内容</p>\n`;
  }
  html += `    </div>\n`;

  // Blogs section
  html += `\n    <div class="section">\n      <h2><span class="emoji">📝</span>官方博客</h2>\n`;
  
  if (blogs.length > 0) {
    blogs.slice(0, 3).forEach(post => {
      const title = escapeHtml(post.title || 'Untitled');
      const source = escapeHtml(post.source || '');
      const author = escapeHtml(post.author || '');
      const url = post.url ? escapeHtml(post.url) : '#';
      const publishedAt = formatDate(post.publishedAt);
      const summary = escapeHtml(post.summary || '');
      
      let meta = source;
      if (author) meta += ` | ${author}`;
      if (publishedAt) meta += ` | ${publishedAt}`;
      
      html += `
      <div class="item">
        <h3>${title}</h3>
        <p class="meta">${meta}</p>
        ${summary ? `<p>${summary}</p>` : ''}
        <p><a href="${url}" target="_blank">阅读全文 →</a></p>
      </div>
`;
    });
  } else {
    html += `      <p class="empty">暂无新内容</p>\n`;
  }
  html += `    </div>\n`;

  html += `
    <div class="footer">
      <p>由 Follow-Builders 自动生成</p>
      <p><a href="https://github.com/zarazhangrui/follow-builders" target="_blank">GitHub 项目</a></p>
    </div>
  </div>
</body>
</html>
`;

  return html;
}

// -- Text Generator ---------------------------------------------------------

function generateText(podcasts, blogs) {
  const today = new Date().toLocaleDateString('zh-CN');
  const safeToday = typeof today === 'string' ? today : new Date().toISOString().split('T')[0];
  
  let text = `🤖 AI Builders Digest - ${safeToday}\n`;
  text += '='.repeat(60) + '\n\n';

  // Podcasts
  text += '🎙️ 播客精华\n';
  text += '-'.repeat(40) + '\n';
  
  if (podcasts.length > 0) {
    podcasts.slice(0, 3).forEach(ep => {
      const title = ep.title || 'Untitled';
      const name = ep.name || '';
      const publishedAt = formatDate(ep.publishedAt);
      const transcript = (ep.transcript || '').substring(0, 200);
      
      text += `\n${title}\n`;
      if (name) text += `${name}`;
      if (publishedAt) text += ` | ${publishedAt}`;
      text += '\n';
      if (transcript) text += `${transcript}...\n`;
      if (ep.url) text += `链接: ${ep.url}\n`;
    });
  } else {
    text += '暂无新内容\n';
  }
  text += '\n';

  // Blogs
  text += '📝 官方博客\n';
  text += '-'.repeat(40) + '\n';
  
  if (blogs.length > 0) {
    blogs.slice(0, 3).forEach(post => {
      const title = post.title || 'Untitled';
      const source = post.source || '';
      const author = post.author || '';
      const publishedAt = formatDate(post.publishedAt);
      const summary = post.summary || '';
      
      text += `\n${title}\n`;
      let meta = source;
      if (author) meta += ` | ${author}`;
      if (publishedAt) meta += ` | ${publishedAt}`;
      if (meta) text += `${meta}\n`;
      if (summary) text += `${summary}\n`;
      if (post.url) text += `链接: ${post.url}\n`;
    });
  } else {
    text += '暂无新内容\n';
  }

  text += '\n' + '='.repeat(60) + '\n';
  text += '由 Follow-Builders 自动生成\n';
  text += 'https://github.com/zarazhangrui/follow-builders\n';

  return text;
}

// -- Helpers ----------------------------------------------------------------

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('zh-CN');
  } catch {
    return '';
  }
}

// -- Main -------------------------------------------------------------------

function main() {
  console.log('Reading feeds...');
  
  const podcasts = readPodcastFeed();
  const blogs = readBlogFeed();
  
  console.log(`  - Podcasts: ${podcasts.length} episodes`);
  console.log(`  - Blogs: ${blogs.length} posts`);
  
  console.log('Generating HTML digest...');
  const html = generateHTML(podcasts, blogs);
  
  console.log('Generating text digest...');
  const text = generateText(podcasts, blogs);
  
  console.log('Writing output files...');
  fs.writeFileSync(HTML_OUTPUT, html, 'utf8');
  fs.writeFileSync(TEXT_OUTPUT, text, 'utf8');
  
  console.log('✅ Digest generated successfully!');
  console.log(`  - ${HTML_OUTPUT}`);
  console.log(`  - ${TEXT_OUTPUT}`);
}

main();

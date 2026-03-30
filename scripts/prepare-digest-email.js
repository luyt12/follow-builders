const fs = require('fs');
const path = require('path');

// 读取 feeds
const feedPodcastsPath = path.join(__dirname, '..', 'feed-podcasts.json');
const feedBlogsPath = path.join(__dirname, '..', 'feed-blogs.json');

let feedPodcasts = { podcasts: [] };
let feedBlogs = { posts: [] };

try {
  feedPodcasts = JSON.parse(fs.readFileSync(feedPodcastsPath, 'utf8'));
} catch (e) {
  console.log('Warning: feed-podcasts.json not found or invalid');
}

try {
  feedBlogs = JSON.parse(fs.readFileSync(feedBlogsPath, 'utf8'));
} catch (e) {
  console.log('Warning: feed-blogs.json not found or invalid');
}

// 生成 HTML 邮件
function generateHTML() {
  const today = new Date().toLocaleDateString('zh-CN');
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
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
    .empty { color: #999; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <h1><span class="emoji">🤖</span>AI Builders Digest</h1>
    <p class="meta">${today} | 每日 AI 行业精华</p>
`;

  // 播客部分
  html += `
    <div class="section">
      <h2><span class="emoji">🎙️</span>播客精华</h2>
`;
  if (feedPodcasts.podcasts && feedPodcasts.podcasts.length > 0) {
    feedPodcasts.podcasts.slice(0, 3).forEach(ep => {
      const transcript = ep.transcript || '';
      const summary = transcript.length > 200 ? transcript.substring(0, 200) + '...' : transcript;
      html += `
      <div class="item">
        <h3>${ep.title || 'Untitled'}</h3>
        <p class="meta">${ep.name || ''} | ${ep.publishedAt ? new Date(ep.publishedAt).toLocaleDateString('zh-CN') : ''}</p>
        ${summary ? `<p>${summary}</p>` : ''}
        <p><a href="${ep.url || '#'}" target="_blank">收听原文 →</a></p>
      </div>
`;
    });
  } else {
    html += `<p class="empty">暂无新内容</p>`;
  }
  html += `    </div>`;

  // 博客部分
  html += `
    <div class="section">
      <h2><span class="emoji">📝</span>官方博客</h2>
`;
  if (feedBlogs.posts && feedBlogs.posts.length > 0) {
    feedBlogs.posts.slice(0, 3).forEach(post => {
      html += `
      <div class="item">
        <h3>${post.title || 'Untitled'}</h3>
        <p class="meta">${post.source || ''} ${post.author ? '| ' + post.author : ''} | ${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('zh-CN') : ''}</p>
        ${post.summary ? `<p>${post.summary}</p>` : ''}
        <p><a href="${post.url || '#'}" target="_blank">阅读全文 →</a></p>
      </div>
`;
    });
  } else {
    html += `<p class="empty">暂无新内容</p>`;
  }
  html += `    </div>`;

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

// 生成纯文本版本
function generateText() {
  const today = new Date().toLocaleDateString('zh-CN');
  let text = `🤖 AI Builders Digest - ${today}\n`;
  text += '='.repeat(60) + '\n\n';

  // 播客
  text += '🎙️ 播客精华\n';
  text += '-'.repeat(40) + '\n';
  if (feedPodcasts.podcasts && feedPodcasts.podcasts.length > 0) {
    feedPodcasts.podcasts.slice(0, 3).forEach(ep => {
      text += `\n${ep.title || 'Untitled'}\n`;
      text += `${ep.name || ''} ${ep.publishedAt ? '| ' + new Date(ep.publishedAt).toLocaleDateString('zh-CN') : ''}\n`;
      const transcript = (ep.transcript || '').substring(0, 200);
      if (transcript) text += `${transcript}...\n`;
      if (ep.url) text += `链接: ${ep.url}\n`;
    });
  } else {
    text += '暂无新内容\n';
  }
  text += '\n';

  // 博客
  text += '📝 官方博客\n';
  text += '-'.repeat(40) + '\n';
  if (feedBlogs.posts && feedBlogs.posts.length > 0) {
    feedBlogs.posts.slice(0, 3).forEach(post => {
      text += `\n${post.title || 'Untitled'}\n`;
      text += `${post.source || ''} ${post.author ? '| ' + post.author : ''} ${post.publishedAt ? '| ' + new Date(post.publishedAt).toLocaleDateString('zh-CN') : ''}\n`;
      if (post.summary) text += `${post.summary}\n`;
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

// 主函数
const html = generateHTML();
const text = generateText();

fs.writeFileSync(path.join(__dirname, '..', 'digest.html'), html);
fs.writeFileSync(path.join(__dirname, '..', 'digest.txt'), text);

console.log('✅ Digest generated successfully!');
console.log('  - digest.html (for email)');
console.log('  - digest.txt (for reference)');

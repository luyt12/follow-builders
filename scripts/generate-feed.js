#!/usr/bin/env node

// ============================================================================
// Follow Builders — Central Feed Generator (YouTube + Blogs Only)
// ============================================================================
// Runs on GitHub Actions (every 6h for podcasts, every 24h for blogs) to
// fetch content and publish feed-podcasts.json and feed-blogs.json.
//
// Deduplication: tracks previously seen video IDs and post URLs in
// state-feed.json so content is never repeated across runs.
//
// Usage: node generate-feed.js [--podcasts-only | --blogs-only]
// Env vars needed: SUPADATA_API_KEY
// ============================================================================

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// -- Constants ---------------------------------------------------------------

const SUPADATA_BASE = 'https://api.supadata.ai/v1';
const LOOKBACK_HOURS = 24;

// State file lives in the repo root so it gets committed by GitHub Actions
const SCRIPT_DIR = decodeURIComponent(new URL('.', import.meta.url).pathname);
const STATE_PATH = join(SCRIPT_DIR, '..', 'state-feed.json');

// -- State Management --------------------------------------------------------

// Tracks which video IDs and post URLs we've already included in feeds
// so we never send the same content twice across runs.

async function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { seenVideos: {}, seenPosts: {} };
  }
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8'));
  } catch {
    return { seenVideos: {}, seenPosts: {} };
  }
}

async function saveState(state) {
  // Prune entries older than 7 days to prevent the file from growing forever
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.seenVideos)) {
    if (ts < cutoff) delete state.seenVideos[id];
  }
  for (const [id, ts] of Object.entries(state.seenPosts)) {
    if (ts < cutoff) delete state.seenPosts[id];
  }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// -- Load Sources ------------------------------------------------------------

async function loadSources() {
  const sourcesPath = join(SCRIPT_DIR, '..', 'config', 'default-sources.json');
  try {
    if (!existsSync(sourcesPath)) {
      console.error('Warning: config/default-sources.json not found, using empty sources');
      return { podcasts: [], blogs: [] };
    }
    return JSON.parse(await readFile(sourcesPath, 'utf-8'));
  } catch (err) {
    console.error(`Warning: Failed to load sources: ${err.message}`);
    return { podcasts: [], blogs: [] };
  }
}

// -- YouTube Fetching (Supadata API) -----------------------------------------

async function fetchYouTubeContent(podcasts, apiKey, state, errors) {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const allCandidates = [];

  for (const podcast of podcasts) {
    try {
      let videosUrl;
      if (podcast.type === 'youtube_playlist') {
        videosUrl = `${SUPADATA_BASE}/youtube/playlist/videos?id=${podcast.playlistId}`;
      } else {
        videosUrl = `${SUPADATA_BASE}/youtube/channel/videos?id=${podcast.channelHandle}&type=video`;
      }

      const videosRes = await fetch(videosUrl, {
        headers: { 'x-api-key': apiKey }
      });

      if (!videosRes.ok) {
        errors.push(`YouTube: Failed to fetch videos for ${podcast.name}: HTTP ${videosRes.status}`);
        continue;
      }

      const videosData = await videosRes.json();
      const videoIds = videosData.videoIds || videosData.video_ids || [];

      // Check first 2 videos per channel, skip already-seen ones
      for (const videoId of videoIds.slice(0, 2)) {
        if (state.seenVideos[videoId]) continue; // dedup

        try {
          const metaRes = await fetch(
            `${SUPADATA_BASE}/youtube/video?id=${videoId}`,
            { headers: { 'x-api-key': apiKey } }
          );
          if (!metaRes.ok) continue;
          const meta = await metaRes.json();
          const publishedAt = meta.uploadDate || meta.publishedAt || meta.date || null;

          allCandidates.push({
            podcast, videoId,
            title: meta.title || 'Untitled',
            publishedAt
          });
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          errors.push(`YouTube: Error fetching metadata for ${videoId}: ${err.message}`);
        }
      }
    } catch (err) {
      errors.push(`YouTube: Error processing ${podcast.name}: ${err.message}`);
    }
  }

  // Pick the 1 most recent video within 24h
  const sorted = allCandidates
    .filter(v => v.publishedAt)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const selected = sorted.find(v => new Date(v.publishedAt) >= cutoff);
  if (!selected) return [];

  // Fetch transcript
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${selected.videoId}`;
    const transcriptRes = await fetch(
      `${SUPADATA_BASE}/youtube/transcript?url=${encodeURIComponent(videoUrl)}&text=true`,
      { headers: { 'x-api-key': apiKey } }
    );

    if (!transcriptRes.ok) {
      errors.push(`YouTube: Failed to get transcript for ${selected.videoId}: HTTP ${transcriptRes.status}`);
      return [];
    }

    const transcriptData = await transcriptRes.json();

    // Mark as seen
    state.seenVideos[selected.videoId] = Date.now();

    return [{
      source: 'podcast',
      name: selected.podcast.name,
      title: selected.title,
      videoId: selected.videoId,
      url: `https://youtube.com/watch?v=${selected.videoId}`,
      publishedAt: selected.publishedAt,
      transcript: transcriptData.content || ''
    }];
  } catch (err) {
    errors.push(`YouTube: Error fetching transcript for ${selected.videoId}: ${err.message}`);
    return [];
  }
}

// -- Blog Fetching (RSS/Atom) -----------------------------------------------

async function fetchBlogContent(blogs, state, errors) {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const results = [];

  for (const blog of blogs) {
    try {
      const res = await fetch(blog.feedUrl, {
        headers: { 'User-Agent': 'Follow-Builders/1.0' }
      });

      if (!res.ok) {
        errors.push(`Blog: Failed to fetch ${blog.name}: HTTP ${res.status}`);
        continue;
      }

      const text = await res.text();
      const posts = parseFeed(text, blog);

      // Find new posts within lookback period
      for (const post of posts) {
        if (state.seenPosts[post.url]) continue; // dedup
        const postDate = new Date(post.publishedAt);
        if (postDate < cutoff) continue;

        results.push({
          source: blog.name,
          title: post.title,
          url: post.url,
          publishedAt: post.publishedAt,
          summary: post.summary || '',
          author: post.author || ''
        });

        // Mark as seen
        state.seenPosts[post.url] = Date.now();

        if (results.length >= 5) break; // Max 5 blog posts per run
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors.push(`Blog: Error fetching ${blog.name}: ${err.message}`);
    }
  }

  return results;
}

// Simple RSS/Atom parser
function parseFeed(text, blog) {
  const posts = [];
  
  // Try RSS 2.0
  const rssItems = text.match(/<item[^>]*>([\s\S]*?)<\/item>/gi) || [];
  for (const item of rssItems) {
    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'dc:date') || extractTag(item, 'published');
    const description = extractTag(item, 'description') || extractTag(item, 'content:encoded');
    const author = extractTag(item, 'author') || extractTag(item, 'dc:creator');
    
    if (title && link) {
      posts.push({
        title: cleanHtml(title),
        url: cleanHtml(link),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary: cleanHtml(stripHtml(description || '')).substring(0, 300),
        author: cleanHtml(author || '')
      });
    }
  }

  // Try Atom
  if (posts.length === 0) {
    const atomEntries = text.match(/<entry[^>]*>([\s\S]*?)<\/entry>/gi) || [];
    for (const entry of atomEntries) {
      const title = extractTag(entry, 'title');
      const link = extractLink(entry);
      const pubDate = extractTag(entry, 'published') || extractTag(entry, 'updated');
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content');
      const author = extractTag(entry, 'name', 'author');
      
      if (title && link) {
        posts.push({
          title: cleanHtml(title),
          url: cleanHtml(link),
          publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          summary: cleanHtml(stripHtml(summary || '')).substring(0, 300),
          author: cleanHtml(author || '')
        });
      }
    }
  }

  return posts;
}

function extractTag(xml, tag, subtag = null) {
  const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (match && subtag) {
    return extractTag(match[1], subtag);
  }
  return match ? match[1] : null;
}

function extractLink(entry) {
  const match = entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match ? match[1] : null;
}

function cleanHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// -- Main --------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const podcastsOnly = args.includes('--podcasts-only');
  const blogsOnly = args.includes('--blogs-only');

  const supadataKey = process.env.SUPADATA_API_KEY;

  if (!supadataKey) {
    console.error('SUPADATA_API_KEY not set');
    process.exit(1);
  }

  const sources = await loadSources();
  const state = await loadState();
  const errors = [];

  // Ensure sources object exists
  const podcastSources = sources?.podcasts || [];
  const blogSources = sources?.blogs || [];

  // Fetch podcasts (YouTube)
  let podcasts = [];
  if (!blogsOnly && podcastSources.length > 0) {
    console.error('Fetching YouTube content...');
    podcasts = await fetchYouTubeContent(podcastSources, supadataKey, state, errors);
    console.error(`  Found ${podcasts.length} new episodes`);
  }

  // Always write podcast feed (even if empty)
  const podcastFeed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    podcasts,
    stats: { podcastEpisodes: podcasts.length },
    errors: errors.filter(e => e.startsWith('YouTube')).length > 0
      ? errors.filter(e => e.startsWith('YouTube')) : undefined
  };
  await writeFile(join(SCRIPT_DIR, '..', 'feed-podcasts.json'), JSON.stringify(podcastFeed, null, 2));
  console.error(`  feed-podcasts.json: ${podcasts.length} episodes`);

  // Fetch blogs
  let blogs = [];
  if (!podcastsOnly && blogSources.length > 0) {
    console.error('Fetching blog content...');
    blogs = await fetchBlogContent(blogSources, state, errors);
    console.error(`  Found ${blogs.length} new posts`);
  }

  // Always write blog feed (even if empty)
  const blogFeed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    posts: blogs,
    stats: { blogPosts: blogs.length },
    errors: errors.filter(e => e.startsWith('Blog')).length > 0
      ? errors.filter(e => e.startsWith('Blog')) : undefined
  };
  await writeFile(join(SCRIPT_DIR, '..', 'feed-blogs.json'), JSON.stringify(blogFeed, null, 2));
  console.error(`  feed-blogs.json: ${blogs.length} posts`);

  // Save dedup state
  await saveState(state);

  if (errors.length > 0) {
    console.error(`  ${errors.length} non-fatal errors`);
  }
}

main().catch(err => {
  console.error('Feed generation failed:', err.message);
  process.exit(1);
});

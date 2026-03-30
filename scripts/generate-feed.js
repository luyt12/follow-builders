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
const PODCAST_FEED_PATH = join(SCRIPT_DIR, '..', 'feed-podcasts.json');
const BLOG_FEED_PATH = join(SCRIPT_DIR, '..', 'feed-blogs.json');

// -- State Management --------------------------------------------------------

async function loadState() {
  try {
    if (!existsSync(STATE_PATH)) {
      return { seenVideos: {}, seenPosts: {} };
    }
    const data = await readFile(STATE_PATH, 'utf-8');
    const state = JSON.parse(data);
    // Ensure both properties exist
    return {
      seenVideos: state.seenVideos || {},
      seenPosts: state.seenPosts || {}
    };
  } catch (err) {
    console.error(`Warning: Failed to load state: ${err.message}`);
    return { seenVideos: {}, seenPosts: {} };
  }
}

async function saveState(state) {
  try {
    // Ensure state object has required properties
    const safeState = {
      seenVideos: state?.seenVideos || {},
      seenPosts: state?.seenPosts || {}
    };
    
    // Prune entries older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const videos = safeState.seenVideos;
    const posts = safeState.seenPosts;
    
    for (const id of Object.keys(videos)) {
      if (videos[id] < cutoff) delete videos[id];
    }
    for (const id of Object.keys(posts)) {
      if (posts[id] < cutoff) delete posts[id];
    }
    
    await writeFile(STATE_PATH, JSON.stringify(safeState, null, 2));
  } catch (err) {
    console.error(`Warning: Failed to save state: ${err.message}`);
    // Don't throw - state save failure shouldn't stop the process
  }
}

// -- Load Sources ------------------------------------------------------------

async function loadSources() {
  const sourcesPath = join(SCRIPT_DIR, '..', 'config', 'default-sources.json');
  try {
    if (!existsSync(sourcesPath)) {
      console.error('Error: config/default-sources.json not found');
      return { podcasts: [], blogs: [] };
    }
    const data = await readFile(sourcesPath, 'utf-8');
    const sources = JSON.parse(data);
    return {
      podcasts: Array.isArray(sources.podcasts) ? sources.podcasts : [],
      blogs: Array.isArray(sources.blogs) ? sources.blogs : []
    };
  } catch (err) {
    console.error(`Error: Failed to load sources: ${err.message}`);
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
      transcript: typeof transcriptData.content === 'string' ? transcriptData.content : ''
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
      const posts = parseFeed(text);

      // Find new posts within lookback period
      for (const post of posts) {
        if (!post.url || !post.title) continue;
        if (state.seenPosts[post.url]) continue; // dedup
        const postDate = new Date(post.publishedAt);
        if (isNaN(postDate.getTime())) continue;
        if (postDate < cutoff) continue;

        results.push({
          source: blog.name || 'Unknown',
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
function parseFeed(text) {
  if (!text || typeof text !== 'string') return [];
  
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
  try {
    const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    if (match && subtag) {
      return extractTag(match[1], subtag);
    }
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractLink(entry) {
  try {
    const match = entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function cleanHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// -- Feed Writers -----------------------------------------------------------

async function writePodcastFeed(podcasts, errors) {
  const feed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    podcasts: Array.isArray(podcasts) ? podcasts : [],
    stats: { podcastEpisodes: Array.isArray(podcasts) ? podcasts.length : 0 },
    errors: errors.filter(e => e.startsWith('YouTube')).length > 0
      ? errors.filter(e => e.startsWith('YouTube')) : undefined
  };
  
  try {
    await writeFile(PODCAST_FEED_PATH, JSON.stringify(feed, null, 2));
    console.error(`  feed-podcasts.json: ${feed.stats.podcastEpisodes} episodes`);
  } catch (err) {
    console.error(`Error writing feed-podcasts.json: ${err.message}`);
    throw err;
  }
}

async function writeBlogFeed(blogs, errors) {
  const feed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    posts: Array.isArray(blogs) ? blogs : [],
    stats: { blogPosts: Array.isArray(blogs) ? blogs.length : 0 },
    errors: errors.filter(e => e.startsWith('Blog')).length > 0
      ? errors.filter(e => e.startsWith('Blog')) : undefined
  };
  
  try {
    await writeFile(BLOG_FEED_PATH, JSON.stringify(feed, null, 2));
    console.error(`  feed-blogs.json: ${feed.stats.blogPosts} posts`);
  } catch (err) {
    console.error(`Error writing feed-blogs.json: ${err.message}`);
    throw err;
  }
}

// -- Main --------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const podcastsOnly = args.includes('--podcasts-only');
  const blogsOnly = args.includes('--blogs-only');

  const supadataKey = process.env.SUPADATA_API_KEY;

  if (!supadataKey) {
    console.error('Error: SUPADATA_API_KEY not set');
    process.exit(1);
  }

  const sources = await loadSources();
  const state = await loadState();
  const errors = [];

  // Fetch podcasts (YouTube)
  let podcasts = [];
  if (!blogsOnly && sources.podcasts.length > 0) {
    console.error('Fetching YouTube content...');
    podcasts = await fetchYouTubeContent(sources.podcasts, supadataKey, state, errors);
    console.error(`  Found ${podcasts.length} new episodes`);
  }

  // Write podcast feed
  await writePodcastFeed(podcasts, errors);

  // Fetch blogs
  let blogs = [];
  if (!podcastsOnly && sources.blogs.length > 0) {
    console.error('Fetching blog content...');
    blogs = await fetchBlogContent(sources.blogs, state, errors);
    console.error(`  Found ${blogs.length} new posts`);
  }

  // Write blog feed
  await writeBlogFeed(blogs, errors);

  // Save dedup state
  await saveState(state);

  if (errors.length > 0) {
    console.error(`  ${errors.length} non-fatal errors:`);
    errors.forEach(e => console.error(`    - ${e}`));
  }
  
  console.error('✅ Feed generation completed');
}

main().catch(err => {
  console.error('Feed generation failed:', err.message);
  process.exit(1);
});

import { NextRequest, NextResponse } from 'next/server';

interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  domain: string;
  // Twitter-specific fields
  type?: 'twitter' | 'generic';
  author?: string;
  authorUsername?: string;
}

// Extract Open Graph and meta tags from HTML
function extractMetadata(html: string, url: string): LinkMetadata {
  const domain = new URL(url).hostname.replace(/^www\./, '');

  // Helper to extract content from meta tags
  const getMetaContent = (property: string): string | undefined => {
    // Try og: prefix first
    const ogMatch = html.match(
      new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
    ) || html.match(
      new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, 'i')
    );
    if (ogMatch) return ogMatch[1];

    // Try twitter: prefix
    const twitterMatch = html.match(
      new RegExp(`<meta[^>]*name=["']twitter:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
    ) || html.match(
      new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']twitter:${property}["']`, 'i')
    );
    if (twitterMatch) return twitterMatch[1];

    // Try standard meta name
    const metaMatch = html.match(
      new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i')
    ) || html.match(
      new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, 'i')
    );
    if (metaMatch) return metaMatch[1];

    return undefined;
  };

  // Extract title
  let title = getMetaContent('title');
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    title = titleMatch?.[1]?.trim();
  }

  // Extract description
  const description = getMetaContent('description');

  // Extract image
  let image = getMetaContent('image');
  if (image && !image.startsWith('http')) {
    // Handle relative URLs
    try {
      image = new URL(image, url).href;
    } catch {
      image = undefined;
    }
  }

  return {
    url,
    title: title ? decodeHTMLEntities(title) : undefined,
    description: description ? decodeHTMLEntities(description) : undefined,
    image,
    domain,
  };
}

// Decode HTML entities
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Check if URL is a YouTube video
function isYouTubeUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    return hostname === 'youtube.com' || hostname === 'youtu.be' || hostname === 'm.youtube.com';
  } catch {
    return false;
  }
}

// Fetch YouTube metadata using oEmbed API
async function fetchYouTubeMetadata(url: string): Promise<LinkMetadata> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`YouTube oEmbed failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      url,
      domain: 'youtube.com',
      title: data.title,
      description: data.author_name ? `by ${data.author_name}` : undefined,
      image: data.thumbnail_url,
    };
  } catch (error) {
    console.error('YouTube oEmbed error:', error);
    return {
      url,
      domain: 'youtube.com',
      title: 'YouTube Video',
    };
  }
}

// Check if URL is a Twitter/X post (tweet)
function isTwitterTweetUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (urlObj.hostname === 'twitter.com' || urlObj.hostname === 'x.com' ||
            urlObj.hostname === 'www.twitter.com' || urlObj.hostname === 'www.x.com') &&
           urlObj.pathname.includes('/status/');
  } catch {
    return false;
  }
}

// Check if URL is a Twitter/X profile page
function isTwitterProfileUrl(url: string): { isProfile: boolean; username?: string } {
  try {
    const urlObj = new URL(url);
    const isTwitterDomain = urlObj.hostname === 'twitter.com' || urlObj.hostname === 'x.com' ||
                            urlObj.hostname === 'www.twitter.com' || urlObj.hostname === 'www.x.com';
    if (!isTwitterDomain) return { isProfile: false };

    // Extract username from path (e.g., /worldcoin or /worldcoin?s=21)
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length === 1 && !['status', 'home', 'explore', 'search', 'notifications', 'messages', 'settings', 'i'].includes(pathParts[0])) {
      return { isProfile: true, username: pathParts[0] };
    }
    return { isProfile: false };
  } catch {
    return { isProfile: false };
  }
}

// Fetch Twitter metadata using oEmbed API
async function fetchTwitterMetadata(url: string): Promise<LinkMetadata> {
  const domain = new URL(url).hostname.replace(/^www\./, '');

  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const response = await fetch(oembedUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Twitter oEmbed failed: ${response.status}`);
    }

    const data = await response.json();

    // Extract tweet text from HTML (oEmbed returns HTML)
    // Format: <blockquote>...<p>TWEET TEXT with <br> and <a> tags</p>...— AUTHOR (@username)</blockquote>
    let tweetText = '';
    const pMatch = data.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch) {
      // Clean up the tweet text:
      // 1. Replace <br> with newlines
      // 2. Remove anchor tags but keep their text
      // 3. Remove any remaining HTML tags
      // 4. Decode HTML entities
      tweetText = pMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    }

    return {
      url,
      domain,
      type: 'twitter',
      title: tweetText || data.author_name,
      author: data.author_name,
      authorUsername: data.author_url?.split('/').pop(),
    };
  } catch (error) {
    console.error('Twitter oEmbed error:', error);
    return {
      url,
      domain,
      type: 'twitter',
    };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'URL parameter is required' },
      { status: 400 }
    );
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL' },
      { status: 400 }
    );
  }

  try {
    // Handle YouTube URLs specially using oEmbed
    if (isYouTubeUrl(url)) {
      const metadata = await fetchYouTubeMetadata(url);
      return NextResponse.json(metadata, {
        headers: {
          'Cache-Control': 'public, max-age=604800, s-maxage=604800',
        },
      });
    }

    // Handle Twitter/X tweet URLs specially using oEmbed
    if (isTwitterTweetUrl(url)) {
      const metadata = await fetchTwitterMetadata(url);
      return NextResponse.json(metadata, {
        headers: {
          'Cache-Control': 'public, max-age=604800, s-maxage=604800',
        },
      });
    }

    // Handle Twitter/X profile URLs with a static fallback
    // (X blocks most scraping, so we provide a meaningful fallback)
    const profileCheck = isTwitterProfileUrl(url);
    if (profileCheck.isProfile && profileCheck.username) {
      const metadata: LinkMetadata = {
        url,
        domain: 'x.com',
        type: 'twitter',
        title: `@${profileCheck.username} on X`,
        description: 'View profile on X (formerly Twitter)',
        author: profileCheck.username,
        authorUsername: profileCheck.username,
      };
      return NextResponse.json(metadata, {
        headers: {
          'Cache-Control': 'public, max-age=604800, s-maxage=604800',
        },
      });
    }

    // Fetch the URL with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WorldChat/1.0; +https://world.org)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status}` },
        { status: 502 }
      );
    }

    const contentType = response.headers.get('content-type') || '';

    // For non-HTML content, return basic metadata
    if (!contentType.includes('text/html')) {
      const domain = new URL(url).hostname.replace(/^www\./, '');
      return NextResponse.json({
        url,
        domain,
        title: domain,
      } satisfies LinkMetadata, {
        headers: {
          'Cache-Control': 'public, max-age=604800, s-maxage=604800',
        },
      });
    }

    const html = await response.text();
    const metadata = extractMetadata(html, url);

    return NextResponse.json(metadata, {
      headers: {
        // Cache for 1 week (browser and CDN)
        'Cache-Control': 'public, max-age=604800, s-maxage=604800',
      },
    });
  } catch (error) {
    console.error('Link preview error:', error);

    // Return basic metadata on error (short cache so we can retry)
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return NextResponse.json({
      url,
      domain,
    } satisfies LinkMetadata, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  }
}

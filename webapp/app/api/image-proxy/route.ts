import { NextRequest, NextResponse } from 'next/server';

const TRUSTED_CDN = 'chat-assets.toolsforhumanity.com';

/**
 * Proxy for XMTP image attachments
 * Fetches images server-side to avoid CORS issues with the CDN
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Validate URL is from trusted CDN
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== TRUSTED_CDN) {
      return NextResponse.json({ error: 'Untrusted source' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WorldChat/1.0',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}

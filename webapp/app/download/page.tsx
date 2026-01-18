import Image from "next/image";
import { Download, Apple } from "lucide-react";

const GITHUB_RELEASE_URL =
  "https://api.github.com/repos/andy-t-wang/world-chat-desktop/releases/latest";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

async function getLatestRelease(): Promise<Release | null> {
  try {
    const res = await fetch(GITHUB_RELEASE_URL, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export default async function DownloadPage() {
  const release = await getLatestRelease();
  const dmgAsset = release?.assets.find((a) => a.name.endsWith(".dmg"));
  const version = release?.tag_name?.replace("v", "") || "";

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* App icon */}
        <Image
          src="/app-icon.png"
          alt="World Chat"
          width={80}
          height={80}
          className="mb-6"
        />

        {/* Title */}
        <h1 className="text-[28px] font-semibold text-[#1D1D1F] tracking-[-0.02em] mb-2">
          World Chat for Mac
        </h1>

        {/* Version */}
        {version && (
          <p className="text-[15px] text-[#86868B] mb-8">Version {version}</p>
        )}

        {/* Download button */}
        {dmgAsset ? (
          <a
            href={dmgAsset.browser_download_url}
            className="flex items-center gap-3 px-6 py-3 bg-[#1D1D1F] text-white rounded-xl hover:bg-[#333] transition-colors"
          >
            <Apple className="w-5 h-5" />
            <div className="flex flex-col items-start">
              <span className="text-[15px] font-medium">Download for Mac</span>
              <span className="text-[12px] text-white/60">
                {formatSize(dmgAsset.size)} · Apple Silicon
              </span>
            </div>
            <Download className="w-4 h-4 ml-2" />
          </a>
        ) : (
          <p className="text-[15px] text-[#86868B]">
            Download temporarily unavailable. Try again later.
          </p>
        )}

        {/* Requirements */}
        <div className="mt-12 text-center">
          <p className="text-[13px] text-[#86868B]">
            Requires macOS 11 Big Sur or later
          </p>
          <p className="text-[13px] text-[#86868B] mt-1">
            Apple Silicon (M1/M2/M3)
          </p>
        </div>
      </div>
    </div>
  );
}

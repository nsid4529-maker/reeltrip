import type { Metadata } from "next";
import "./globals.css";
import "./workspace-navigation.css";
import "./library-refresh.css";
import "./trips-refresh.css";
import "./preview-cards.css";
import "./bucket-agent.css";
import "./accessibility.css";
import "./reel-upload.css";
import "./specialist-preparation.css";
import "./shared-buckets.css";
import {NativeInterests} from '@/components/native-interests';
import {NativeReels} from '@/components/native-reels';
import {BucketAgent} from '@/components/bucket-agent';
import {ReelUploadDialog} from '@/components/reel-upload';

export const metadata: Metadata = {
  title: "ReelTrip — From saved reels to real trips",
  description: "Turn reviewed TikTok and Instagram travel videos into day-by-day itinerary drafts, food recommendations and provider searches. Plan as a guest.",
  metadataBase: new URL('https://reeltrip-travel-studio.earthylark68.chatgpt.site'),
  alternates: { canonical: '/' },
  openGraph: { type: 'website', locale: 'en_GB', siteName: 'ReelTrip', title: 'ReelTrip — From saved reels to real trips', description: 'Import travel inspiration, review the evidence and build a day-by-day itinerary draft.', url: '/' },
  twitter: { card: 'summary', title: 'ReelTrip — From saved reels to real trips', description: 'Source-linked travel planning, food ideas and itinerary drafts. No account needed.' },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<NativeReels/><NativeInterests/><BucketAgent/><ReelUploadDialog/></body>
    </html>
  );
}

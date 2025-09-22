export const metadata = { title: "D4D", description: "Driving for Dollars" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}

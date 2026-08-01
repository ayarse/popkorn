import { Show, SignInButton, UserButton } from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  BookText,
  ChevronDown,
  Flag,
  HelpCircle,
  Images,
  Menu,
  Send,
  Sparkles,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ImportStatusChip } from "@/components/import-status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { examples } from "@/examples";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { CommunityScene } from "@/hooks/use-scene";
import { track } from "@/lib/analytics";
import type { ImportResult } from "@/lib/import-size";
import { reportScene } from "@/lib/scenes";
import { startTour } from "@/lib/tour";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.38.97.1-.75.4-1.26.73-1.55-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.71 5.41-5.29 5.69.42.36.79 1.08.79 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

export function AppHeader({
  currentExample,
  onSelectExample,
  community,
  importResult,
  onDismissImport,
  onImport,
  onShare,
  chatOpen,
  onToggleChat,
}: {
  currentExample: string | null;
  onSelectExample: (key: string) => void;
  community: CommunityScene | null;
  importResult: ImportResult | null;
  onDismissImport: () => void;
  onImport: () => void;
  onShare: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [reported, setReported] = useState(false);

  const exampleItems = (
    <>
      <DropdownMenuLabel className="flex items-center justify-between">
        <span>Example scenes</span>
        <span className="text-[10px] font-normal tracking-widest text-muted-foreground">
          {examples.length}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {examples.map((ex) => (
        <DropdownMenuCheckboxItem
          key={ex.key}
          checked={currentExample === ex.key}
          onCheckedChange={() => onSelectExample(ex.key)}
        >
          {ex.label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <BrandMark
        suffix={
          <span className="ml-1.5 hidden max-w-[22ch] truncate text-[13px] font-normal text-muted-foreground sm:inline">
            {community
              ? `${community.title}${community.author ? ` by ${community.author}` : ""}`
              : "Playground"}
          </span>
        }
      />

      {/* Below `sm` the three destinations, the tour and the repo link fold
          into one menu — the scene actions are what people came to press, and
          they're what the row has width for. Swapped by media query rather
          than CSS-hidden twins so `[data-tour]` matches one live element. */}
      {isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-tour="examples"
              variant="ghost"
              size="icon"
              aria-label="Menu"
            >
              <Menu className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
          >
            <DropdownMenuItem onSelect={() => navigate({ to: "/docs" })}>
              <BookText className="size-3.5" />
              Docs
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/community" })}>
              <Images className="size-3.5" />
              Community
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startTour()}>
              <HelpCircle className="size-3.5" />
              Take a tour
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href="https://github.com/ayarse/popkorn"
                target="_blank"
                rel="noreferrer"
                onClick={() => track("github_click")}
              >
                <GithubMark className="size-3.5" />
                GitHub
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {exampleItems}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ to: "/docs" })}
          >
            <BookText className="size-3.5" />
            Docs
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ to: "/community" })}
          >
            <Images className="size-3.5" />
            Community
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-tour="examples"
                variant="ghost"
                size="sm"
                className="gap-1.5"
              >
                Examples
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
            >
              {exampleItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {importResult && (
          <ImportStatusChip result={importResult} onDismiss={onDismissImport} />
        )}
        <Button
          data-tour="import"
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={onImport}
        >
          <Upload className="size-3.5" />
          <span className="hidden sm:inline">Import Lottie/SVG</span>
        </Button>
        {/* Owning a scene means editing it, not republishing it — the save,
            retag and delete controls live in the player toolbar. */}
        {!community?.mine && (
          <Button
            data-tour="publish"
            size="sm"
            className="gap-1.5"
            onClick={onShare}
          >
            <Send className="size-3.5" />
            <span className="hidden sm:inline">Publish an animation</span>
          </Button>
        )}
        <Button
          data-tour="copilot"
          variant={chatOpen ? "default" : "secondary"}
          size="sm"
          className="gap-1.5"
          onClick={onToggleChat}
        >
          <Sparkles className="size-3.5" />
          <span className="hidden sm:inline">Copilot</span>
        </Button>
        {community && !community.mine && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={reported}
                aria-label={reported ? "Reported" : "Report this scene"}
                onClick={() => {
                  setReported(true);
                  void reportScene({ data: community.id });
                }}
              >
                <Flag className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {reported ? "Reported" : "Report this scene"}
            </TooltipContent>
          </Tooltip>
        )}
        {!isMobile && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startTour()}
                  aria-label="Take a tour"
                >
                  <HelpCircle className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Take a tour</TooltipContent>
            </Tooltip>
            <a
              href="https://github.com/ayarse/popkorn"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub repository"
              onClick={() => track("github_click")}
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <GithubMark className="size-4" />
              <span className="sr-only">GitHub repository</span>
            </a>
          </>
        )}
        <Show
          when="signed-in"
          fallback={
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </SignInButton>
          }
        >
          <UserButton />
        </Show>
      </div>
    </header>
  );
}

import {
  ChevronDown,
  Layers,
  Maximize,
  PanelBottom,
  PanelBottomDashed,
  Repeat,
  RepeatOff,
} from "lucide-react";
import {
  BgSwatch,
  BgSwatchGrid,
  PLAYER_BACKGROUNDS,
} from "@/components/bg-context-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type FitMode = "contain" | "cover" | "fill" | "none";

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
  { value: "none", label: "None" },
];

export type RendererKind = "canvas" | "svg";

const RENDERERS: { value: RendererKind; label: string }[] = [
  { value: "canvas", label: "Canvas" },
  { value: "svg", label: "SVG (WIP)" },
];

/** Toolbar radio dropdown (fit mode / renderer backend). */
function RadioMenu<T extends string>({
  icon: Icon,
  tooltip,
  options,
  value,
  onChange,
  width,
}: {
  icon: typeof Maximize;
  tooltip: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  width: string;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Icon className="size-3.5" />
              {options.find((o) => o.value === value)?.label}
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className={width}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as T)}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Icon toggle with a state-dependent tooltip. */
function ToggleButton({
  on,
  onToggle,
  onIcon: OnIcon,
  offIcon: OffIcon,
  label,
  onTip,
  offTip,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  onIcon: typeof Repeat;
  offIcon: typeof Repeat;
  onTip: string;
  offTip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-pressed={on}
          aria-label={label}
        >
          {on ? <OnIcon className="size-4" /> : <OffIcon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{on ? onTip : offTip}</TooltipContent>
    </Tooltip>
  );
}

/** Fit mode, renderer backend, loop and controls-bar toggles. */
export function ViewControls({
  fit,
  onFit,
  renderer,
  onRenderer,
  loop,
  onToggleLoop,
  controls,
  onToggleControls,
}: {
  fit: FitMode;
  onFit: (v: FitMode) => void;
  renderer: RendererKind;
  onRenderer: (v: RendererKind) => void;
  loop: boolean;
  onToggleLoop: () => void;
  controls: boolean;
  onToggleControls: () => void;
}) {
  return (
    <>
      <RadioMenu
        icon={Maximize}
        tooltip="Fit mode"
        options={FIT_MODES}
        value={fit}
        onChange={onFit}
        width="w-32"
      />
      {/* Renderer backend (dev/testing affordance) */}
      <RadioMenu
        icon={Layers}
        tooltip="Renderer backend"
        options={RENDERERS}
        value={renderer}
        onChange={onRenderer}
        width="w-36"
      />
      <ToggleButton
        on={loop}
        onToggle={onToggleLoop}
        label="Loop playback"
        onIcon={Repeat}
        offIcon={RepeatOff}
        onTip="Loop playback"
        offTip="Loop playback (off)"
      />
      <ToggleButton
        on={controls}
        onToggle={onToggleControls}
        label="Playback controls"
        onIcon={PanelBottom}
        offIcon={PanelBottomDashed}
        onTip="Hide playback controls"
        offTip="Show playback controls"
      />
    </>
  );
}

/** Background color popover. */
export function BgPicker({
  bgIndex,
  onSelect,
}: {
  bgIndex: number;
  onSelect: (i: number) => void;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon">
              <BgSwatch
                bg={PLAYER_BACKGROUNDS[bgIndex]}
                className="size-4 border-border/60"
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Background color</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-48 p-1.5">
        <BgSwatchGrid bgIndex={bgIndex} onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  );
}

import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

type BrandMarkProps = {
  suffix?: React.ReactNode
  className?: string
}

export function BrandMark({ suffix, className }: BrandMarkProps) {
  return (
    <Link to="/" className={cn('flex items-center gap-2 pr-2', className)}>
      <div className="size-5 rounded-md bg-gradient-to-br from-primary to-accent" />
      <h1 className="text-[15px] font-semibold tracking-tight">Popcorn</h1>
      {suffix}
    </Link>
  )
}
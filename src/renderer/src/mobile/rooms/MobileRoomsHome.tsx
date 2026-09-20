import { MoreHorizontal, Plus, Search } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import './mobile-rooms-home.css'

export type MobileRoomsHomeProps = {
  rooms: readonly RoomSidebarEntry[]
  search: string
  filter: 'all' | 'unread' | 'attention'
  loading: boolean
  error: string
  hasMore: boolean
  labels: {
    title: string; search: string; create: string; more: string; empty: string; loading: string
    retry: string; loadMore: string; all: string; unread: string; attention: string
  }
  onSearch: (value: string) => void
  onFilter: (filter: 'all' | 'unread' | 'attention') => void
  onOpen: (roomId: string) => void
  onMenu: (roomId: string) => void
  onCreate: () => void
  onRetry: () => void
  onLoadMore: () => void
}

export function MobileRoomsHome(props: MobileRoomsHomeProps) {
  const { rooms, search, filter, loading, error, hasMore, labels, onSearch, onFilter,
    onOpen, onMenu, onCreate, onRetry, onLoadMore } = props
  return <section className="kun-mobile-rooms-home" aria-label={labels.title}>
    <header><h1>{labels.title}</h1><button type="button" onClick={onCreate} aria-label={labels.create}>
      <Plus aria-hidden /></button></header>
    <label className="kun-mobile-rooms-search"><Search size={18} aria-hidden />
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
        placeholder={labels.search} aria-label={labels.search} />
    </label>
    <div className="kun-mobile-room-filters" role="group" aria-label={labels.title}>
      {(['all', 'unread', 'attention'] as const).map((value) => <button key={value} type="button"
        aria-pressed={filter === value} onClick={() => onFilter(value)}>{labels[value]}</button>)}
    </div>
    <div className="kun-mobile-room-list" aria-busy={loading}>
      {error ? <div role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={onRetry}>{labels.retry}</button></div> : null}
      {!error && rooms.length === 0 ? <p role="status">{loading ? labels.loading : labels.empty}</p> : null}
      <ul>{rooms.map((room) => {
        const unread = Math.max(0, (room.latestMessageSeq ?? 0) - (room.readSeq ?? 0))
        return <li key={room.id}>
          <button type="button" className="kun-mobile-room-open" onClick={() => onOpen(room.roomId ?? room.id)}>
            <strong>{room.name}</strong>
            <span>{room.latestMessage?.authorLabelSnapshot ? `${room.latestMessage.authorLabelSnapshot}: ` : ''}{room.latestMessage?.preview ?? ''}</span>
            <small>{room.kind === 'user_agent' ? 'Agent' : room.kind === 'agent_agent' ? 'Agents' : `${room.members.length}`}</small>
            {unread > 0 ? <span className="kun-mobile-room-count" aria-label={`${unread} ${labels.unread}`}>{Math.min(unread, 99)}</span> : null}
            {(room.attentionCount ?? 0) > 0 ? <span className="kun-mobile-room-attention">{labels.attention}</span> : null}
          </button>
          <button type="button" className="kun-mobile-room-menu" onClick={() => onMenu(room.roomId ?? room.id)} aria-label={`${labels.more}: ${room.name}`}>
            <MoreHorizontal size={20} aria-hidden /></button>
        </li>
      })}</ul>
      {hasMore ? <button type="button" className="kun-mobile-rooms-more" disabled={loading} onClick={onLoadMore}>
        {loading ? labels.loading : labels.loadMore}</button> : null}
    </div>
  </section>
}

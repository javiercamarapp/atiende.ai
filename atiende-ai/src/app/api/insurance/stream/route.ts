import { NextRequest } from 'next/server'
import { Redis } from '@upstash/redis'
import { SSE_POLL_INTERVAL_MS, SSE_HEARTBEAT_INTERVAL_MS } from '@/lib/insurance/constants'

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get('id')
  if (!requestId) {
    return new Response('Missing id parameter', { status: 400 })
  }

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          closed = true
        }
      }

      send('connected', { request_id: requestId })

      let lastCompleted = 0

      const poll = setInterval(async () => {
        if (closed) { clearInterval(poll); return }

        try {
          const raw = await getRedis().get(`ins:progress:${requestId}`)
          if (!raw) return

          const progress = typeof raw === 'string' ? JSON.parse(raw) : raw

          if (progress.completed > lastCompleted || progress.failed > 0) {
            lastCompleted = progress.completed
            send('progress', progress)
          }

          if (progress.status === 'complete') {
            send('complete', progress)
            clearInterval(poll)
            clearInterval(heartbeat)
            setTimeout(() => {
              closed = true
              try { controller.close() } catch { /* already closed */ }
            }, 500)
          }
        } catch {
          // Redis error — skip this poll cycle
        }
      }, SSE_POLL_INTERVAL_MS)

      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return }
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          closed = true
        }
      }, SSE_HEARTBEAT_INTERVAL_MS)

      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(poll)
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'none',
    },
  })
}

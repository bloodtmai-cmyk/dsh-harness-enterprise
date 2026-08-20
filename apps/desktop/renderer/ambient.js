(() => {
  const canvas = document.querySelector('#ambient-canvas')
  const context = canvas?.getContext('2d')
  if (!(canvas instanceof HTMLCanvasElement) || context === null) return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = { x: 0.72, y: 0.28, targetX: 0.72, targetY: 0.28 }
  const whaleImage = new Image()
  let whalePoints = []
  let frame
  let width = 1
  let height = 1
  let visible = true
  let lastPaint = 0
  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)

  function buildWhalePoints() {
    if (!whaleImage.complete || whaleImage.naturalWidth === 0) return
    const buffer = document.createElement('canvas')
    const bufferContext = buffer.getContext('2d')
    if (bufferContext === null) return
    buffer.width = 180
    buffer.height = 135
    bufferContext.drawImage(whaleImage, 0, 0, buffer.width, buffer.height)
    const pixels = bufferContext.getImageData(0, 0, buffer.width, buffer.height).data
    const next = []
    for (let y = 2; y < buffer.height; y += 4) {
      for (let x = 2; x < buffer.width; x += 4) {
        if (pixels[(y * buffer.width + x) * 4 + 3] > 72) {
          next.push({ x, y, phase: (x * 0.17 + y * 0.11) % (Math.PI * 2) })
        }
      }
    }
    whalePoints = next
    draw(performance.now())
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect()
    width = Math.max(1, bounds.width)
    height = Math.max(1, bounds.height)
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    draw(performance.now())
  }

  function drawRibbon(time, index) {
    const phase = time * (0.00012 + index * 0.000018) + index * 1.7
    const y = height * (0.12 + index * 0.19)
    const sway = Math.sin(phase * 2.1) * height * 0.12
    const gradient = context.createLinearGradient(-width * 0.1, 0, width * 1.1, 0)
    gradient.addColorStop(0, 'rgba(66, 126, 190, 0)')
    gradient.addColorStop(0.28, index % 2 === 0 ? 'rgba(229, 224, 192, 0.18)' : 'rgba(74, 137, 207, 0.23)')
    gradient.addColorStop(0.66, index % 2 === 0 ? 'rgba(93, 154, 218, 0.29)' : 'rgba(238, 225, 187, 0.16)')
    gradient.addColorStop(1, 'rgba(53, 104, 166, 0)')

    context.beginPath()
    context.moveTo(-width * 0.16, y + sway)
    context.bezierCurveTo(
      width * 0.18,
      y - height * 0.3 + Math.sin(phase) * 60,
      width * 0.7,
      y + height * 0.34 + Math.cos(phase * 1.3) * 70,
      width * 1.16,
      y - sway * 0.6,
    )
    context.strokeStyle = gradient
    context.lineWidth = Math.max(38, height * (0.08 + index * 0.012))
    context.lineCap = 'round'
    context.stroke()
  }

  function drawWhale(time) {
    if (whalePoints.length === 0) return
    const targetWidth = Math.min(260, width * 0.62)
    const scale = targetWidth / 180
    const originX = width * 0.73 - targetWidth / 2 + (pointer.x - 0.5) * 18
    const originY = height * 0.02 + (pointer.y - 0.5) * 12
    const pulse = 0.92 + Math.sin(time * 0.0011) * 0.08

    context.save()
    context.globalCompositeOperation = 'screen'
    for (const point of whalePoints) {
      const shimmer = 0.55 + 0.45 * Math.sin(time * 0.002 + point.phase)
      const drift = Math.sin(time * 0.0014 + point.phase) * 1.4
      context.fillStyle = `rgba(198, 224, 249, ${0.12 + shimmer * 0.24})`
      context.beginPath()
      context.arc(
        originX + point.x * scale + drift,
        originY + point.y * scale + Math.cos(time * 0.0012 + point.phase) * 1.1,
        Math.max(0.65, scale * 0.68 * pulse),
        0,
        Math.PI * 2,
      )
      context.fill()
    }
    context.restore()
  }

  function draw(time) {
    pointer.x += (pointer.targetX - pointer.x) * 0.035
    pointer.y += (pointer.targetY - pointer.y) * 0.035
    context.clearRect(0, 0, width, height)
    context.save()
    context.globalCompositeOperation = 'screen'
    context.filter = 'blur(24px)'
    context.translate((pointer.x - 0.5) * 12, (pointer.y - 0.5) * 8)
    for (let index = 0; index < 3; index += 1) drawRibbon(time, index)
    context.restore()
    drawWhale(time)
  }

  function tick(time) {
    if (!visible || reducedMotion.matches) return
    frame = requestAnimationFrame(tick)
    if (time - lastPaint < 1000 / 30) return
    lastPaint = time
    draw(time)
  }

  function start() {
    cancelAnimationFrame(frame)
    draw(performance.now())
    if (!reducedMotion.matches && visible) frame = requestAnimationFrame(tick)
  }

  window.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect()
    pointer.targetX = (event.clientX - bounds.left) / Math.max(1, width)
    pointer.targetY = (event.clientY - bounds.top) / Math.max(1, height)
  }, { passive: true })
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden
    start()
  })
  reducedMotion.addEventListener('change', start)
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame)
    resizeObserver?.disconnect()
  }, { once: true })
  whaleImage.addEventListener('load', buildWhalePoints, { once: true })
  whaleImage.src = './assets/hero-whale.svg'
  resizeObserver?.observe(canvas)
  resize()
  start()
})()

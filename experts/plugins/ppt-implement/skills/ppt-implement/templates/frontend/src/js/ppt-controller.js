
export class PPTController {
    constructor() {
        this.currentIndex = 0
        this.slides = []
        this.totalSlides = 0
        
        this.viewport = document.getElementById('ppt-viewport')
        this.prevBtn = document.getElementById('prevBtn')
        this.nextBtn = document.getElementById('nextBtn')
        this.progressBarFill = document.getElementById('progressBarFill')
        this.pageIndicator = document.getElementById('pageIndicator')
        
        this.init()
        this.initWindowMessage();
    }
    
    init() {
        this.loadSlides()
        this.bindEvents()
        this.initializePage()
        this.updateUI()
        this.updateViewportScale()
    }

    initWindowMessage() {
        // 监听来自外部的 postMessage
        window.addEventListener('message', (event) => {
            // 过滤掉一些非相关的消息
            if (!event.data || typeof event.data !== 'object') {
                return;
            }
            const { type, data } = event.data;
            if (type === 'childrenstart') {
                // 进入dom编辑，隐藏这些按钮
                this.prevBtn.style.visibility = 'hidden'
                this.nextBtn.style.visibility = 'hidden'
                this.progressBarFill.style.visibility = 'hidden'
                this.pageIndicator.style.visibility = 'hidden'
            } else if (type === 'childrenstop') {
                // 退出dom编辑，隐藏这些按钮
                this.prevBtn.style.visibility = 'visible'
                this.nextBtn.style.visibility = 'visible'
                this.progressBarFill.style.visibility = 'visible'
                this.pageIndicator.style.visibility = 'visible'
            }
        });
    }
    
    initializePage() {
        // 从 URL 获取 page 参数
        const urlParams = new URLSearchParams(window.location.search)
        let pageParam = urlParams.get('page')
        
        // 如果没有 page 参数，默认设置为 1
        if (!pageParam) {
            pageParam = '1'
            urlParams.set('page', '1')
            const newUrl = `${window.location.pathname}?${urlParams.toString()}`
            window.history.replaceState({}, '', newUrl)
        }
        
        const pageNum = parseInt(pageParam, 10)
        // 转换为索引（page 从 1 开始，index 从 0 开始）
        const targetIndex = pageNum - 1
        
        // 验证页码有效性
        if (!isNaN(pageNum) && targetIndex >= 0 && targetIndex < this.totalSlides) {
            // 移除默认的第一页激活状态
            if (this.slides[0]) {
                this.slides[0].classList.remove('active')
            }
            
            // 设置目标页为激活状态
            this.currentIndex = targetIndex
            if (this.slides[targetIndex]) {
                this.slides[targetIndex].classList.add('active')
            }
        } else {
            console.warn(`无效的页码参数: ${pageParam}，将显示第 1 页`)
            // 无效页码时也更新 URL 为 page=1
            urlParams.set('page', '1')
            const newUrl = `${window.location.pathname}?${urlParams.toString()}`
            window.history.replaceState({}, '', newUrl)
        }
    }
    
    loadSlides() {
        if (typeof window.slideDataMap === 'undefined') {
            console.error('未找到 slideDataMap')
            return
        }
        
        // 获取所有页码并排序
        const pageNumbers = Array.from(window.slideDataMap.keys()).sort((a, b) => a - b)
        this.totalSlides = pageNumbers.length
        
        // 如果没有幻灯片，直接返回
        if (this.totalSlides === 0) {
            console.warn('slideDataMap 为空，没有幻灯片可加载')
            return
        }
        
        // 插入每一页
        pageNumbers.forEach((pageNum, idx) => {
            const slideDiv = document.createElement('div')
            slideDiv.className = 'slide'
            // 默认第一页激活（如果没有 URL 参数会使用这个）
            if (idx === 0) slideDiv.classList.add('active')
            
            // 解析 HTML 字符串
            const htmlContent = window.slideDataMap.get(pageNum)
            if (!htmlContent || typeof htmlContent !== 'string') {
                this.totalSlides--;
                console.error(`未找到页码 ${pageNum} 的内容, 或者页码 ${pageNum} 的内容为空`)
                return;
            }
            const contentEl = document.createElement('div')
            contentEl.innerHTML = htmlContent.trim()
            slideDiv.appendChild(contentEl)
            this.viewport.appendChild(slideDiv)
            this.slides.push(slideDiv)
        })
    }
    
    bindEvents() {
        // 按钮点击
        this.prevBtn.addEventListener('click', () => this.prevSlide())
        this.nextBtn.addEventListener('click', () => this.nextSlide())
        
        // 键盘导航
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                this.prevSlide()
            } else if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault()
                this.nextSlide()
            } else if (e.key === 'Home') {
                this.goToSlide(0)
            } else if (e.key === 'End') {
                this.goToSlide(this.totalSlides - 1)
            }
        })
        
        // 触摸滑动（移动端）
        let touchStartX = 0
        this.viewport.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX
        })
        
        this.viewport.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX
            const diff = touchStartX - touchEndX
            
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    this.nextSlide()
                } else {
                    this.prevSlide()
                }
            }
        })
        
        // 窗口缩放时更新视口缩放
        window.addEventListener('resize', () => this.updateViewportScale())
    }
    
    prevSlide() {
        if (this.currentIndex > 0) {
            this.goToSlide(this.currentIndex - 1)
        }
    }
    
    nextSlide() {
        if (this.currentIndex < this.totalSlides - 1) {
            this.goToSlide(this.currentIndex + 1)
        }
    }
    
    goToSlide(index) {
        if (index < 0 || index >= this.totalSlides) return
        
        // 移除当前激活状态
        this.slides[this.currentIndex].classList.remove('active')
        
        // 设置新的激活状态
        this.currentIndex = index
        this.slides[this.currentIndex].classList.add('active')
        
        // 更新 URL 参数
        this.updateUrlPage(index + 1)
        
        this.updateUI()
    }
    
    updateUrlPage(pageNum) {
        const urlParams = new URLSearchParams(window.location.search)
        urlParams.set('page', pageNum.toString())
        const newUrl = `${window.location.pathname}?${urlParams.toString()}`
        window.history.replaceState({}, '', newUrl)
    }
    
    updateUI() {
        // 如果没有幻灯片，显示生成中状态
        if (this.totalSlides === 0) {
            this.prevBtn.disabled = true
            this.nextBtn.disabled = true
            this.progressBarFill.style.width = '0%'
            this.pageIndicator.textContent = '制作中'
            return
        }
        
        // 更新按钮状态
        this.prevBtn.disabled = this.currentIndex === 0
        this.nextBtn.disabled = this.currentIndex === this.totalSlides - 1
        
        // 更新进度条
        const progress = ((this.currentIndex + 1) / this.totalSlides) * 100
        this.progressBarFill.style.width = `${progress}%`
        
        // 更新页码指示器
        this.pageIndicator.textContent = `${this.currentIndex + 1} / ${this.totalSlides}`
    }
    
    updateViewportScale() {
        // 基准尺寸：1440x810 (16:9)
        const baseWidth = 1440
        const baseHeight = 810
        
        // 获取窗口尺寸（留出一些边距）
        const padding = 20
        const windowWidth = window.innerWidth - padding * 2
        const windowHeight = window.innerHeight - padding * 2
        
        // 计算缩放比例（取最小值以确保完全显示）
        const scaleX = windowWidth / baseWidth
        const scaleY = windowHeight / baseHeight
        const scale = Math.min(scaleX, scaleY, 1) // 不超过1倍
        
        // 应用缩放
        this.viewport.style.transform = `scale(${scale})`
        
        console.log(`窗口: ${window.innerWidth}x${window.innerHeight}, 缩放: ${scale.toFixed(3)}`)
    }
}

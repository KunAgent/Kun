/**
 * 路由处理器
 * 检测页面是否存在，如果不存在则跳转到 404 页面
 */
export class RouteHandler {
    constructor() {
        this.validRoutes = ['/', '/index.html']
        this.checkRoute()
    }

    checkRoute() {
        const currentPath = window.location.pathname
        
        // 如果是 404 页面本身，不做处理
        if (currentPath.includes('404.html')) {
            return
        }

        // 检查是否是有效路由
        const isValidRoute = this.validRoutes.some(route => {
            if (route === '/') {
                return currentPath === '/' || currentPath === '/index.html'
            }
            return currentPath === route
        })

        // 如果路由无效，跳转到 404 页面
        if (!isValidRoute) {
            console.warn(`Invalid route detected: ${currentPath}, redirecting to 404`)
            window.location.href = '/404.html'
        }
    }

    /**
     * 添加有效路由
     * @param {string} route - 路由路径
     */
    addRoute(route) {
        if (!this.validRoutes.includes(route)) {
            this.validRoutes.push(route)
        }
    }

    /**
     * 检查路由是否有效
     * @param {string} route - 路由路径
     * @returns {boolean}
     */
    isValidRoute(route) {
        return this.validRoutes.includes(route)
    }
}

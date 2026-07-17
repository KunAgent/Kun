<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);">
  <!-- 科技线条网格 -->
  <div class="absolute inset-0" style="background: linear-gradient(90deg, rgba(82, 139, 255, 0.05) 1px, transparent 1px), linear-gradient(0deg, rgba(82, 139, 255, 0.05) 1px, transparent 1px); background-size: 50px 50px;"></div>

  <!-- 发光线条 - 左上到右下 -->
  <div class="absolute top-0 left-0 w-full h-[2px]" style="background: linear-gradient(90deg, transparent, #528bff, transparent); box-shadow: 0 0 10px rgba(82, 139, 255, 0.8); animation: moveLine1 3s ease-in-out infinite;"></div>

  <!-- 发光线条 - 右上到左下 -->
  <div class="absolute top-0 right-0 w-[2px] h-full" style="background: linear-gradient(180deg, transparent, #00d9ff, transparent); box-shadow: 0 0 10px rgba(0, 217, 255, 0.8); animation: moveLine2 3s ease-in-out infinite;"></div>

  <!-- 圆形装饰 -->
  <div class="absolute top-[15%] left-[15%] w-[100px] h-[100px] rounded-full border-2 border-[rgba(82,139,255,0.4)]" style="box-shadow: 0 0 20px rgba(82, 139, 255, 0.3);">
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60px] h-[60px] rounded-full border border-[rgba(82,139,255,0.3)]"></div>
  </div>

  <div class="absolute bottom-[15%] right-[15%] w-[80px] h-[80px] rounded-full border-2 border-[rgba(0,217,255,0.4)]" style="box-shadow: 0 0 20px rgba(0, 217, 255, 0.3);">
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50px] h-[50px] rounded-full border border-[rgba(0,217,255,0.3)]"></div>
  </div>

  <!-- 主要内容 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex items-center justify-center">
    <div class="text-center w-[75%]">
      <h1 class="text-[70px] text-white font-light mb-[42px] tracking-[8px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 0 20px rgba(82, 139, 255, 0.5);">感谢</h1>
      
      <div class="w-[150px] h-[2px] mx-auto mb-[40px]" style="background: linear-gradient(to right, #528bff, #00d9ff); box-shadow: 0 0 10px rgba(82, 139, 255, 0.6);"></div>
      
      <p class="text-[23px] text-[#b8d4e8] font-light leading-[1.8] tracking-[2px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">感谢您的聆听与关注</p>
    </div>
  </div>

  <style>
    @keyframes moveLine1 {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(100vh); }
    }
    @keyframes moveLine2 {
      0%, 100% { transform: translateX(0); }
      50% { transform: translateX(-100vw); }
    }
  </style>
</div>

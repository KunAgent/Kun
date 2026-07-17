<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #ffd1ff 100%);">
  <!-- 五边形装饰 -->
  <div class="absolute top-[10%] left-[8%] w-[100px] h-[95px] bg-[rgba(255,255,255,0.15)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation: float 4s ease-in-out infinite;"></div>
  <div class="absolute top-[60%] right-[10%] w-[120px] h-[114px] bg-[rgba(255,255,255,0.12)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation: float 5s ease-in-out infinite 1s;"></div>
  <div class="absolute bottom-[8%] left-[15%] w-[90px] h-[86px] bg-[rgba(255,255,255,0.18)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation: float 4.5s ease-in-out infinite 0.5s;"></div>
  
  <!-- 中心五边形框架 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[238px] border-[3px] border-[rgba(255,255,255,0.35)] bg-[rgba(255,255,255,0.08)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">感谢</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">感谢您的聆听与关注</p>
  </div>
  
  <!-- 小五边形装饰 -->
  <div class="absolute top-[30%] left-[20%] w-[50px] h-[48px] bg-[rgba(255,255,255,0.22)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation: pulse 2.5s ease-in-out infinite;"></div>
  <div class="absolute top-[40%] right-[25%] w-[60px] h-[57px] bg-[rgba(255,255,255,0.2)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation: pulse 3s ease-in-out infinite 0.8s;"></div>
  <div class="absolute bottom-[25%] left-[30%] w-[55px] h-[52px] bg-[rgba(255,255,255,0.25)]" style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation: pulse 2.8s ease-in-out infinite 1.5s;"></div>

  <style>
    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-20px) rotate(10deg); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.15); }
    }
  </style>
</div>

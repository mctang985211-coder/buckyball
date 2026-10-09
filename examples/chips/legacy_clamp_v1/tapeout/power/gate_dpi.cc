#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vpi_user.h>
static std::string uart_line;
static unsigned long long sim_ns() {
  s_vpi_time t{};
  t.type = vpiSimTime;
  vpi_get_time(nullptr, &t);
  const auto ticks = (static_cast<unsigned long long>(t.high) << 32) | t.low;
  const int precision = vpi_get(vpiTimePrecision, nullptr);
  return static_cast<unsigned long long>(
      std::llround(ticks * std::pow(10.0, precision + 9)));
}

extern "C" void dpi_bdb_set_clk(unsigned long long) {}

extern "C" void scu_uart_write(std::uint32_t, std::uint32_t ch) {
  std::fputc(static_cast<int>(ch & 0xff), stdout);
  std::fflush(stdout);
  if ((ch & 0xff) == '\n') {
    if (uart_line == "CLAMP_ACTIVITY_BEGIN" ||
        uart_line == "CLAMP_ACTIVITY_END")
      std::fprintf(stdout, "[CLAMP_WINDOW] %s %llu\n", uart_line.c_str(),
                   sim_ns());
    uart_line.clear();
  } else if ((ch & 0xff) != '\r')
    uart_line.push_back(static_cast<char>(ch & 0xff));
}

// Gate power runs use the requested measurement horizon, rather than ending
// when a workload's SCU writes its completion register.
extern "C" void scu_sim_exit(std::uint32_t hart, std::uint32_t code) {
  std::fprintf(stderr, "[SCU] hart %u: workload exit code %u\n", hart, code);
  std::fflush(stderr);
}

extern "C" void scu_uart_rx_sample(std::uint32_t, std::uint32_t,
                                   std::uint32_t *valid, std::uint32_t *data) {
  *valid = 0;
  *data = 0;
}

extern "C" void dpi_itrace(std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t) {}
extern "C" void dpi_mtrace(std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t, std::uint32_t, std::uint32_t,
                           std::uint32_t) {}
extern "C" void dpi_pmctrace(std::uint32_t, std::uint32_t, std::uint32_t,
                             std::uint32_t) {}
extern "C" void dpi_mem_pmctrace(std::uint32_t, std::uint32_t, std::uint32_t,
                                 std::uint32_t) {}
extern "C" void dpi_mtrace_issue(std::uint32_t, std::uint32_t, std::uint32_t,
                                 std::uint32_t, std::uint32_t, std::uint32_t) {}

        points: Array.isArray(item.points) ? item.points.slice(0, 8) : undefined, paneIndex: item.paneIndex,
      }));
      const indicators = (chart?.indicators?.() || []).map((item: any) => {
        const rawValues = typeof item.values === 'function' ? item.values() : {};
        const values: Record<string, any> = {};
        for (const [plotKey, column] of Object.entries(rawValues || {})) {
          const series = Array.isArray(column) ? column as any[] : [];
          const latestIndex = [...series].map((value: any, index: number) => ({ value, index })).reverse().find((entry: any) => Number.isFinite(Number(entry.value)))?.index ?? -1;
          values[plotKey] = {
            latest: latestIndex >= 0 ? Number(series[latestIndex]) : null,
            latestTime: latestIndex >= 0 ? (bars[latestIndex]?.time ?? null) : null,
            recent: series.slice(Math.max(0, series.length - 20)).map((value: any, offset: number) => ({
              time: bars[Math.max(0, series.length - 20) + offset]?.time ?? null,
              value: Number.isFinite(Number(value)) ? Number(value) : null,
            })),
          };
        }
        return {
          id: item.id,
          indicatorId: item.indicatorId,
          name: item.name,
          paneIndex: item.paneIndex,
          visible: typeof item.visible === 'function' ? item.visible() : true,
          settings: typeof item.settings === 'function' ? item.settings() : {},
          values,
          dataStatus: typeof item.dataStatus === 'function' ? item.dataStatus() : null,
          rendered: Object.values(values).some((entry: any) => Number.isFinite(Number(entry.latest))),
        };
      });
      const last = bars[bars.length - 1];
      const context = {
        symbol: symbolRef.current,
        name: instrumentsRef.current.find(item => item.symbol === symbolRef.current)?.name || symbolRef.current,
        timeframe: timeframeRef.current,
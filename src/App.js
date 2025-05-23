import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Search, TrendingUp, Target, PieChart, BarChart3, AlertCircle, Info, ArrowRight, ArrowLeft, ShoppingBasket } from 'lucide-react';
import * as math from 'mathjs';
import Papa from 'papaparse';

const PortfolioOptimizer = () => {
  const [data, setData] = useState(null);
  const [assets, setAssets] = useState([]);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchTerm, setSelectedSearchTerm] = useState('');
  const [targetReturn, setTargetReturn] = useState(0.12);
  const [optimizedPortfolio, setOptimizedPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [optimizationType, setOptimizationType] = useState('efficient');
  const [error, setError] = useState(null);

  // File upload handler
  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    
    Papa.parse(file, {
      complete: (results) => {
        try {
          const headers = results.data[0].map(h => h.trim());
          const rows = results.data.slice(1).filter(row => row.some(cell => cell && cell.trim()));
          
          if (headers.length < 3) {
            throw new Error('CSV must have at least a date column and 2 asset columns');
          }

          // Assume first column is date, rest are asset prices
          const assetNames = headers.slice(1);
          const priceData = {};
          
          assetNames.forEach((asset, idx) => {
            const prices = rows.map(row => {
              const price = parseFloat(row[idx + 1]);
              return isNaN(price) ? null : price;
            }).filter(val => val !== null);
            
            if (prices.length < 30) {
              console.warn(`Asset ${asset} has less than 30 data points`);
            }
            
            priceData[asset] = prices;
          });

          const validAssets = Object.keys(priceData).filter(asset => priceData[asset].length >= 10);
          
          if (validAssets.length < 2) {
            throw new Error('Need at least 2 assets with sufficient data points');
          }

          setData(priceData);
          setAssets(validAssets);
          setSelectedAssets([]);
          
        } catch (error) {
          console.error('Error parsing CSV:', error);
          setError(error.message || 'Error parsing CSV file. Please check the format.');
        } finally {
          setLoading(false);
        }
      },
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false
    });
  }, []);

  // Calculate returns from price data
  const calculateReturns = useCallback((prices) => {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i-1] > 0 && prices[i] > 0) {
        returns.push((prices[i] - prices[i-1]) / prices[i-1]);
      }
    }
    return returns;
  }, []);

  // Calculate statistics with proper error handling
  const calculateAssetStatistics = useCallback((returns) => {
    const n = returns.length;
    const meanReturns = returns.map(assetReturns => {
      const validReturns = assetReturns.filter(r => !isNaN(r) && isFinite(r));
      return validReturns.length > 0 ? validReturns.reduce((sum, r) => sum + r, 0) / validReturns.length : 0;
    });
    
    // Calculate covariance matrix with proper handling
    const covMatrix = [];
    for (let i = 0; i < n; i++) {
      covMatrix[i] = [];
      for (let j = 0; j < n; j++) {
        const returnsI = returns[i].filter(r => !isNaN(r) && isFinite(r));
        const returnsJ = returns[j].filter(r => !isNaN(r) && isFinite(r));
        const meanI = meanReturns[i];
        const meanJ = meanReturns[j];
        
        let covariance = 0;
        const minLength = Math.min(returnsI.length, returnsJ.length);
        
        if (minLength > 1) {
          for (let k = 0; k < minLength; k++) {
            covariance += (returnsI[k] - meanI) * (returnsJ[k] - meanJ);
          }
          covMatrix[i][j] = covariance / (minLength - 1);
        } else {
          covMatrix[i][j] = i === j ? 0.01 : 0; // Small diagonal value to avoid singularity
        }
      }
    }

    return { meanReturns, covMatrix };
  }, []);

  // Enhanced portfolio optimization with proper risk handling
  const optimizePortfolio = useCallback(() => {
    if (!data || selectedAssets.length < 2) {
      setError('Please select at least 2 assets for optimization');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const returns = selectedAssets.map(asset => calculateReturns(data[asset]));
      const n = returns.length;
      
      // Validate data quality
      const minDataPoints = Math.min(...returns.map(r => r.length));
      if (minDataPoints < 10) {
        throw new Error('Insufficient data points for reliable optimization');
      }

      const { meanReturns, covMatrix } = calculateAssetStatistics(returns);
      
      // Annualize returns and covariance
      const annualizedMeanReturns = meanReturns.map(r => r * 252);
      const annualizedCovMatrix = covMatrix.map(row => row.map(val => val * 252));
      
      let weights;
      let optimizationInfo = '';
      
      if (optimizationType === 'minVar') {
        // Minimum variance portfolio using inverse variance weighting
        const variances = annualizedCovMatrix.map((row, i) => Math.max(row[i], 0.0001));
        const invVariances = variances.map(v => 1 / v);
        const sumInvVar = invVariances.reduce((sum, iv) => sum + iv, 0);
        weights = invVariances.map(iv => iv / sumInvVar);
        optimizationInfo = 'Minimum variance portfolio using inverse variance weighting';
        
      } else if (optimizationType === 'maxReturn') {
        // Maximum return portfolio - allocate to highest return assets
        const sortedReturns = annualizedMeanReturns
          .map((ret, idx) => ({ ret, idx }))
          .sort((a, b) => b.ret - a.ret);
        
        weights = new Array(n).fill(0);
        
        // Allocate more to higher return assets with some diversification
        let remainingWeight = 1.0;
        
        for (let i = 0; i < Math.min(5, sortedReturns.length) && remainingWeight > 0.01; i++) {
          const idx = sortedReturns[i].idx;
          // Allocate decreasing amounts to top assets
          const allocation = Math.min(0.5 * Math.pow(0.7, i), remainingWeight);
          weights[idx] = allocation;
          remainingWeight -= allocation;
        }
        
        // Distribute remaining weight equally among selected assets
        if (remainingWeight > 0.01) {
          const selectedCount = weights.filter(w => w > 0).length;
          for (let i = 0; i < n; i++) {
            if (weights[i] > 0) {
              weights[i] += remainingWeight / selectedCount;
            }
          }
        }
        
        optimizationInfo = 'Maximum return portfolio with diversification constraints';
        
      } else {
        // Efficient frontier optimization - balance risk and return
        // Use return-to-risk ratios for initial allocation
        const returnToRiskRatios = annualizedMeanReturns.map((ret, i) => {
          const variance = Math.max(annualizedCovMatrix[i][i], 0.0001);
          return Math.max(ret, 0.01) / Math.sqrt(variance);
        });
        
        // Initial weights based on return-to-risk ratios
        const totalRatio = returnToRiskRatios.reduce((sum, ratio) => sum + Math.max(ratio, 0), 0);
        weights = returnToRiskRatios.map(ratio => Math.max(ratio, 0) / totalRatio);
        
        // Adjust for target return through iterative optimization
        const currentReturn = weights.reduce((sum, w, i) => sum + w * annualizedMeanReturns[i], 0);
        const returnGap = targetReturn - currentReturn;
        
        if (Math.abs(returnGap) > 0.001) {
          // Find assets that can help achieve target return
          const returnDiff = annualizedMeanReturns.map(ret => ret - currentReturn);
          
          for (let iter = 0; iter < 50; iter++) {
            let totalAdjustment = 0;
            const newWeights = [...weights];
            
            for (let i = 0; i < n; i++) {
              if (returnGap > 0 && returnDiff[i] > 0) {
                // Increase weight for above-average return assets
                const increase = Math.min(0.02, returnGap * 0.1 * (returnDiff[i] / Math.abs(returnGap)));
                newWeights[i] += increase;
                totalAdjustment += increase;
              } else if (returnGap < 0 && returnDiff[i] < 0) {
                // Increase weight for below-average return assets
                const increase = Math.min(0.02, Math.abs(returnGap) * 0.1 * (Math.abs(returnDiff[i]) / Math.abs(returnGap)));
                newWeights[i] += increase;
                totalAdjustment += increase;
              }
            }
            
            // Normalize weights
            if (totalAdjustment > 0) {
              const totalWeight = newWeights.reduce((sum, w) => sum + w, 0);
              weights = newWeights.map(w => w / totalWeight);
              
              const newReturn = weights.reduce((sum, w, i) => sum + w * annualizedMeanReturns[i], 0);
              if (Math.abs(targetReturn - newReturn) < Math.abs(returnGap) * 0.9) {
                break;
              }
            } else {
              break;
            }
          }
        }
        
        optimizationInfo = `Efficient frontier optimization targeting ${(targetReturn * 100).toFixed(1)}% return`;
      }

      // Ensure weights sum to 1 and are non-negative
      weights = weights.map(w => Math.max(w, 0));
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      if (totalWeight > 0) {
        weights = weights.map(w => w / totalWeight);
      } else {
        weights = new Array(n).fill(1/n); // Equal weights fallback
      }

      // Calculate final portfolio statistics
      const portfolioReturn = weights.reduce((sum, w, i) => sum + w * annualizedMeanReturns[i], 0);
      const portfolioVariance = calculatePortfolioVariance(weights, annualizedCovMatrix);
      const portfolioStd = Math.sqrt(Math.max(portfolioVariance, 0));
      const sharpeRatio = portfolioStd > 0 ? portfolioReturn / portfolioStd : 0;

      const result = {
        expectedReturn: portfolioReturn,
        volatility: portfolioStd,
        sharpeRatio,
        weights,
        assets: selectedAssets,
        optimization: optimizationType,
        optimizationInfo,
        meanReturns: annualizedMeanReturns,
        riskContribution: weights.map((w, i) => (w * w * annualizedCovMatrix[i][i]) / portfolioVariance),
        diversificationRatio: calculateDiversificationRatio(weights, annualizedCovMatrix)
      };

      setOptimizedPortfolio(result);
      
    } catch (error) {
      console.error('Optimization error:', error);
      setError(error.message || 'Error during optimization. Please check your data.');
    } finally {
      setLoading(false);
    }
  }, [data, selectedAssets, targetReturn, optimizationType, calculateReturns, calculateAssetStatistics]);

  // Helper function to calculate portfolio variance
  const calculatePortfolioVariance = useCallback((weights, covMatrix) => {
    let variance = 0;
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights.length; j++) {
        variance += weights[i] * weights[j] * covMatrix[i][j];
      }
    }
    return Math.max(variance, 0);
  }, []);

  // Calculate diversification ratio
  const calculateDiversificationRatio = useCallback((weights, covMatrix) => {
    const weightedAvgVol = weights.reduce((sum, w, i) => sum + w * Math.sqrt(covMatrix[i][i]), 0);
    const portfolioVol = Math.sqrt(calculatePortfolioVariance(weights, covMatrix));
    return portfolioVol > 0 ? weightedAvgVol / portfolioVol : 1;
  }, [calculatePortfolioVariance]);

  // Filter available assets based on search
  const filteredAvailableAssets = useMemo(() => {
    return assets.filter(asset => 
      !selectedAssets.includes(asset) && 
      asset.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [assets, selectedAssets, searchTerm]);

  // Filter selected assets based on search
  const filteredSelectedAssets = useMemo(() => {
    return selectedAssets.filter(asset => 
      asset.toLowerCase().includes(selectedSearchTerm.toLowerCase())
    );
  }, [selectedAssets, selectedSearchTerm]);

  // Move asset to selected basket
  const moveToSelected = useCallback((asset) => {
    setSelectedAssets(prev => [...prev, asset]);
  }, []);

  // Move asset back to available basket
  const moveToAvailable = useCallback((asset) => {
    setSelectedAssets(prev => prev.filter(a => a !== asset));
  }, []);

  // Move all filtered available assets to selected
  const moveAllToSelected = useCallback(() => {
    setSelectedAssets(prev => [...prev, ...filteredAvailableAssets]);
  }, [filteredAvailableAssets]);

  // Move all selected assets back to available
  const moveAllToAvailable = useCallback(() => {
    setSelectedAssets([]);
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-2">
          <TrendingUp className="text-blue-600" />
          Enhanced Markowitz Portfolio Optimizer
        </h1>
        <p className="text-gray-600 mb-6">
          Upload your asset price data and optimize your portfolio using Modern Portfolio Theory with enhanced risk management
        </p>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-red-800">Error</h4>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* File Upload Section */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 mb-6 hover:border-blue-400 transition-colors">
          <div className="text-center">
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <label className="cursor-pointer">
              <span className="text-lg font-medium text-gray-700">Upload CSV File</span>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <p className="text-sm text-gray-500 mt-2">
              CSV format: Date, Asset1, Asset2, Asset3, ... (price data)
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Minimum 10 data points per asset recommended for reliable optimization
            </p>
          </div>
        </div>

        {data && assets.length > 0 && (
          <div className="space-y-6">
            {/* Stock Baskets Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Available Stocks Basket */}
              <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2 text-blue-800">
                    <ShoppingBasket className="h-5 w-5" />
                    Available Stocks ({filteredAvailableAssets.length})
                  </h3>
                  <button
                    onClick={moveAllToSelected}
                    disabled={filteredAvailableAssets.length === 0}
                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <ArrowRight className="h-3 w-3" />
                    Add All
                  </button>
                </div>
                
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="Search available stocks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div className="min-h-32">
                  {searchTerm.trim() === '' ? (
                    <div className="text-center py-8 text-gray-500">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Start typing to search stocks</p>
                      <p className="text-xs mt-1">{assets.filter(a => !selectedAssets.includes(a)).length} stocks available</p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto space-y-2">
                      {filteredAvailableAssets.map(asset => {
                        const dataPoints = data[asset]?.length || 0;
                        return (
                          <div key={asset} className="flex items-center justify-between bg-white p-3 rounded-lg border border-blue-200 hover:border-blue-300 transition-colors">
                            <div className="flex-1">
                              <span className="text-sm font-medium text-gray-800">{asset}</span>
                              <span className="text-xs text-gray-500 ml-2">({dataPoints} points)</span>
                            </div>
                            <button
                              onClick={() => moveToSelected(asset)}
                              className="ml-2 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex items-center gap-1"
                            >
                              <ArrowRight className="h-3 w-3" />
                              Add
                            </button>
                          </div>
                        );
                      })}
                      {filteredAvailableAssets.length === 0 && searchTerm.trim() !== '' && (
                        <div className="text-center py-8 text-gray-500">
                          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No stocks found matching "{searchTerm}"</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Stocks Basket */}
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2 text-green-800">
                    <Target className="h-5 w-5" />
                    Selected Stocks ({filteredSelectedAssets.length})
                  </h3>
                  <button
                    onClick={moveAllToAvailable}
                    disabled={selectedAssets.length === 0}
                    className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Remove All
                  </button>
                </div>
                
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="Search selected stocks..."
                    value={selectedSearchTerm}
                    onChange={(e) => setSelectedSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2">
                  {filteredSelectedAssets.map(asset => {
                    const dataPoints = data[asset]?.length || 0;
                    return (
                      <div key={asset} className="flex items-center justify-between bg-white p-3 rounded-lg border border-green-200 hover:border-green-300 transition-colors">
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-800">{asset}</span>
                          <span className="text-xs text-gray-500 ml-2">({dataPoints} points)</span>
                        </div>
                        <button
                          onClick={() => moveToAvailable(asset)}
                          className="ml-2 px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 flex items-center gap-1"
                        >
                          <ArrowLeft className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                    );
                  })}
                  {filteredSelectedAssets.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No stocks selected for optimization</p>
                      <p className="text-xs mt-1">Add at least 2 stocks to optimize</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Optimization Parameters */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="h-6 w-6" />
                Optimization Parameters
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Optimization Type
                  </label>
                  <select
                    value={optimizationType}
                    onChange={(e) => setOptimizationType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="efficient">Efficient Frontier</option>
                    <option value="minVar">Minimum Variance</option>
                    <option value="maxReturn">Maximum Return</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Annual Return: {(targetReturn * 100).toFixed(1)}%
                  </label>
                  <input
                    type="range"
                    min="0.05"
                    max="0.30"
                    step="0.01"
                    value={targetReturn}
                    onChange={(e) => setTargetReturn(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={optimizePortfolio}
                  disabled={loading || selectedAssets.length < 2}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg font-semibold"
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <PieChart className="h-5 w-5" />
                  )}
                  Optimize Portfolio
                </button>
                {selectedAssets.length < 2 && (
                  <p className="text-sm text-gray-500 text-center mt-2">
                    Select at least 2 stocks to enable optimization
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {optimizedPortfolio && (
          <div className="mt-6 bg-white border rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <PieChart className="h-6 w-6 text-green-600" />
              Optimized Portfolio Results
            </h3>

            {optimizedPortfolio.optimizationInfo && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-700">{optimizedPortfolio.optimizationInfo}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-medium text-blue-800">Expected Return</h4>
                <p className="text-2xl font-bold text-blue-600">
                  {(optimizedPortfolio.expectedReturn * 100).toFixed(2)}%
                </p>
                <p className="text-sm text-blue-600">Annual</p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <h4 className="font-medium text-red-800">Volatility (Risk)</h4>
                <p className="text-2xl font-bold text-red-600">
                  {(optimizedPortfolio.volatility * 100).toFixed(2)}%
                </p>
                <p className="text-sm text-red-600">Annual Std Dev</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <h4 className="font-medium text-green-800">Sharpe Ratio</h4>
                <p className="text-2xl font-bold text-green-600">
                  {optimizedPortfolio.sharpeRatio.toFixed(3)}
                </p>
                <p className="text-sm text-green-600">Risk-adj. return</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <h4 className="font-medium text-purple-800">Diversification</h4>
                <p className="text-2xl font-bold text-purple-600">
                  {optimizedPortfolio.diversificationRatio.toFixed(2)}
                </p>
                <p className="text-sm text-purple-600">Div. ratio</p>
              </div>
            </div>

            {/* Asset Allocation */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h4 className="font-medium mb-3">Asset Allocation</h4>
              <div className="space-y-2">
                {optimizedPortfolio.assets.map((asset, idx) => {
                  const weight = optimizedPortfolio.weights[idx];
                  const expectedReturn = optimizedPortfolio.meanReturns[idx];
                  return (
                    <div key={asset} className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="text-sm font-medium">{asset}</span>
                        <span className="text-xs text-gray-500 ml-2">
                          ({(expectedReturn * 100).toFixed(1)}% exp. return)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-32 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${weight * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium w-12 text-right">
                          {(weight * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Risk Analysis */}
            <div className="bg-yellow-50 rounded-lg p-4">
              <h4 className="font-medium mb-3 text-yellow-800">Risk Analysis</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-yellow-800">Portfolio Risk Level:</p>
                  <p className="text-yellow-700">
                    {optimizedPortfolio.volatility < 0.1 ? 'Conservative' : 
                     optimizedPortfolio.volatility < 0.2 ? 'Moderate' : 'Aggressive'}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-yellow-800">Annual Volatility:</p>
                  <p className="text-yellow-700">
                    {(optimizedPortfolio.volatility * 100).toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="font-medium text-yellow-800">Largest Position:</p>
                  <p className="text-yellow-700">
                    {(() => {
                      const maxWeightIdx = optimizedPortfolio.weights.indexOf(Math.max(...optimizedPortfolio.weights));
                      return `${optimizedPortfolio.assets[maxWeightIdx]} (${(optimizedPortfolio.weights[maxWeightIdx] * 100).toFixed(1)}%)`;
                    })()}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-yellow-800">Concentration Risk:</p>
                  <p className="text-yellow-700">
                    {Math.max(...optimizedPortfolio.weights) > 0.4 ? 'High' :
                     Math.max(...optimizedPortfolio.weights) > 0.25 ? 'Moderate' : 'Low'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PortfolioOptimizer;
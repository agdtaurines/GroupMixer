import type {
  SavedProblem,
  Problem,
  ProblemResult,
  ProblemSummary,
  ExportedProblem,
  SolverSettings,
  Solution,
} from "../types";

const STORAGE_KEY = "people-distributor-problems";
const CURRENT_PROBLEM_KEY = "people-distributor-current-problem";
const VERSION = "1.0.0";

export class ProblemStorageService {
  private autoSaveTimeout: number | null = null;
  private readonly autoSaveDelay = 2000; // 2 seconds

  // Generate a globally unique ID
  private generateGloballyUniqueId(existingIds: Set<string>): string {
    let newId: string;
    do {
      newId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } while (existingIds.has(newId));
    return newId;
  }

  // Get all saved problems
  getAllProblems(): Record<string, SavedProblem> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("Failed to load problems from storage:", error);
      return {};
    }
  }

  // Get problem summaries for quick overview
  getProblemSummaries(): ProblemSummary[] {
    const problems = this.getAllProblems();
    return Object.values(problems).map((problem) => ({
      id: problem.id,
      name: problem.name,
      peopleCount: problem.problem.people.length,
      groupsCount: problem.problem.groups.length,
      sessionsCount: problem.problem.num_sessions,
      resultsCount: problem.results.length,
      createdAt: problem.createdAt,
      updatedAt: problem.updatedAt,
      isTemplate: problem.isTemplate,
    }));
  }

  // Get a specific problem
  getProblem(id: string): SavedProblem | null {
    const problems = this.getAllProblems();
    return problems[id] || null;
  }

  // Save or update a problem
  saveProblem(problem: SavedProblem): void {
    const problems = this.getAllProblems();
    problems[problem.id] = {
      ...problem,
      updatedAt: Date.now(),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(problems));
    } catch (error) {
      console.error("Failed to save problem to storage:", error);
      throw new Error(
        "Storage quota exceeded. Please delete some problems or export them to files."
      );
    }
  }

  // Create a new problem
  createProblem(
    name: string,
    problem: Problem,
    isTemplate = false
  ): SavedProblem {
    const now = Date.now();
    const allProblems = this.getAllProblems();
    const allProblemIds = new Set(Object.keys(allProblems));
    const id = this.generateGloballyUniqueId(allProblemIds);
    const savedProblem: SavedProblem = {
      id,
      name,
      problem,
      results: [],
      createdAt: now,
      updatedAt: now,
      isTemplate,
    };

    this.saveProblem(savedProblem);
    return savedProblem;
  }

  // Update problem definition (triggers auto-save)
  updateProblem(id: string, problem: Problem): void {
    const savedProblem = this.getProblem(id);
    if (!savedProblem) {
      throw new Error(`Problem with ID ${id} not found`);
    }

    savedProblem.problem = problem;
    this.scheduleAutoSave(savedProblem);
  }

  // Add a result to a problem
  addResult(
    problemId: string,
    solution: Solution,
    solverSettings: SolverSettings,
    customName?: string
  ): ProblemResult {
    const savedProblem = this.getProblem(problemId);
    if (!savedProblem) {
      throw new Error(`Problem with ID ${problemId} not found`);
    }
    // Collect all result IDs in the current problem
    const resultIds = new Set<string>(savedProblem.results.map((r) => r.id));
    const id = this.generateGloballyUniqueId(resultIds);

    const result: ProblemResult = {
      id,
      name: customName || `Result ${savedProblem.results.length + 1}`,
      solution,
      solverSettings,
      timestamp: Date.now(),
      duration: solution.elapsed_time_ms,
    };

    savedProblem.results.push(result);
    this.saveProblem(savedProblem);

    return result;
  }

  // Update result name
  updateResultName(problemId: string, resultId: string, newName: string): void {
    const savedProblem = this.getProblem(problemId);
    if (!savedProblem) {
      throw new Error(`Problem with ID ${problemId} not found`);
    }

    const result = savedProblem.results.find((r) => r.id === resultId);
    if (!result) {
      throw new Error(`Result with ID ${resultId} not found`);
    }

    result.name = newName;
    this.saveProblem(savedProblem);
  }

  // Delete a result
  deleteResult(problemId: string, resultId: string): void {
    const savedProblem = this.getProblem(problemId);
    if (!savedProblem) {
      throw new Error(`Problem with ID ${problemId} not found`);
    }

    savedProblem.results = savedProblem.results.filter(
      (r) => r.id !== resultId
    );
    this.saveProblem(savedProblem);
  }

  // Delete a problem
  deleteProblem(id: string): void {
    const problems = this.getAllProblems();
    delete problems[id];

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(problems));
    } catch (error) {
      console.error("Failed to delete problem from storage:", error);
    }

    // Clear current problem if it was deleted
    if (this.getCurrentProblemId() === id) {
      this.setCurrentProblemId(null);
    }
  }

  // Duplicate a problem (useful for templates)
  duplicateProblem(
    id: string,
    newName: string,
    includeResults = false
  ): SavedProblem {
    const originalProblem = this.getProblem(id);
    if (!originalProblem) {
      throw new Error(`Problem with ID ${id} not found`);
    }

    const now = Date.now();
    const allProblems = this.getAllProblems();
    const allProblemIds = new Set(Object.keys(allProblems));
    const newProblemId = this.generateGloballyUniqueId(allProblemIds);
    const duplicatedProblem: SavedProblem = {
      id: newProblemId,
      name: newName,
      problem: JSON.parse(JSON.stringify(originalProblem.problem)), // Deep clone
      results: includeResults
        ? JSON.parse(JSON.stringify(originalProblem.results))
        : [],
      createdAt: now,
      updatedAt: now,
      isTemplate: false, // Duplicates are not templates by default
    };

    // Generate new IDs for results if included
    if (includeResults) {
      const resultIds = new Set<string>();
      duplicatedProblem.results.forEach((result) => {
        let newResultId;
        do {
          newResultId = this.generateGloballyUniqueId(resultIds);
        } while (resultIds.has(newResultId));
        resultIds.add(newResultId);
        result.id = newResultId;
      });
    }

    this.saveProblem(duplicatedProblem);
    return duplicatedProblem;
  }

  // Rename a problem
  renameProblem(id: string, newName: string): void {
    const savedProblem = this.getProblem(id);
    if (!savedProblem) {
      throw new Error(`Problem with ID ${id} not found`);
    }

    savedProblem.name = newName;
    this.saveProblem(savedProblem);
  }

  // Mark/unmark as template
  toggleTemplate(id: string): void {
    const savedProblem = this.getProblem(id);
    if (!savedProblem) {
      throw new Error(`Problem with ID ${id} not found`);
    }

    savedProblem.isTemplate = !savedProblem.isTemplate;
    this.saveProblem(savedProblem);
  }

  // Current problem management
  getCurrentProblemId(): string | null {
    return localStorage.getItem(CURRENT_PROBLEM_KEY);
  }

  setCurrentProblemId(id: string | null): void {
    if (id) {
      localStorage.setItem(CURRENT_PROBLEM_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_PROBLEM_KEY);
    }
  }

  // Auto-save functionality
  private scheduleAutoSave(problem: SavedProblem): void {
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    this.autoSaveTimeout = window.setTimeout(() => {
      this.saveProblem(problem);
      this.autoSaveTimeout = null;
    }, this.autoSaveDelay);
  }

  // Export problem to JSON
  exportProblem(id: string): ExportedProblem {
    const problem = this.getProblem(id);
    if (!problem) {
      throw new Error(`Problem with ID ${id} not found`);
    }

    return {
      version: VERSION,
      problem,
      exportedAt: Date.now(),
    };
  }

  // Import problem from JSON
  importProblem(exportedData: ExportedProblem, newName?: string): SavedProblem {
    // Validate version compatibility
    if (exportedData.version !== VERSION) {
      console.warn(
        `Importing problem with different version: ${exportedData.version} vs ${VERSION}`
      );
    }

    const now = Date.now();
    const allProblems = this.getAllProblems();
    const allProblemIds = new Set(Object.keys(allProblems));
    const newProblemId = this.generateGloballyUniqueId(allProblemIds);
    const importedProblem: SavedProblem = {
      ...exportedData.problem,
      id: newProblemId, // New ID to avoid conflicts
      name: newName || `${exportedData.problem.name} (Imported)`,
      createdAt: now,
      updatedAt: now,
    };

    // Generate new IDs for all results to avoid conflicts (within this problem)
    const resultIds = new Set<string>();
    importedProblem.results.forEach((result) => {
      let newResultId;
      do {
        newResultId = this.generateGloballyUniqueId(resultIds);
      } while (resultIds.has(newResultId));
      resultIds.add(newResultId);
      result.id = newResultId;
    });

    this.saveProblem(importedProblem);
    return importedProblem;
  }

  // Get storage usage info
  getStorageInfo(): { used: number; available: number; percentage: number } {
    const totalStorage = 5 * 1024 * 1024; // Approximate 5MB localStorage limit
    const used = new Blob([JSON.stringify(this.getAllProblems())]).size;

    return {
      used,
      available: totalStorage - used,
      percentage: (used / totalStorage) * 100,
    };
  }

  // Clear all data (with confirmation)
  clearAllData(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CURRENT_PROBLEM_KEY);
  }
}

// Export singleton instance
export const problemStorage = new ProblemStorageService();
